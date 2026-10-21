// Editing: placed objects (text, check marks, signatures, highlight, white-out, redaction boxes,
// signature fields for envelopes), selection, drag, resize, undo, tools and the context strip.
import { S, PG, emit, on, nextUid } from './state.js';
import { frame, offset, rotOf, toWorld, place, rectFrom } from './geometry.js';
import { $, $$, el, toast, ICON, anyModalOpen } from './ui.js';
import { setHooks, layout, buildPages, rotatePage, scroller } from './viewer.js';
import { openSig } from './signature.js';
import { applyStyle, displayText, textToolbar } from './textstyle.js';
import { initSignature } from './signature.js';
import { ctxHooks, keyHooks } from './hooks.js';
import { libDoc, reloadMain } from './document.js';
import { analyzePage, removeBlock, restoreContents, chooseFont } from './textedit.js';
import { buildBlocks, blockAt, blockRect } from './blocks.js';
import { FONTS, PAD, LINE, baselineAt } from './textstyle.js';

export function markDirty() { const was = S.dirty; S.dirty = true; $('#dirtyDot').hidden = false; if (!was) emit('dirty'); }
export function snapshot() { return JSON.stringify({ o: S.objects, p: S.pages.map(p => [p.uid, p.rot]), b: S.bates, l: S.lifts.length }); }
export function syncUndo() { $('#undoBtn').disabled = !S.undo.length; $('#redoBtn').disabled = !S.redo.length; }
export function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 150) S.undo.shift(); S.redo = []; syncUndo(); }
export function undo() {
  if (!S.undo.length) return;
  const raw = S.undo.pop(), st = JSON.parse(raw);
  // a lift (text taken off the page) is not replayable, so redo is cleared when one is undone
  if (S.lifts.length > (st.l || 0)) S.redo = []; else S.redo.push(snapshot());
  applySnapshot(st);
}
export function redo() {
  if (!S.redo.length) return;
  const st = JSON.parse(S.redo.pop()); S.undo.push(snapshot());
  applySnapshot(st);
}
function applySnapshot(st) {
  if (document.activeElement?.blur) document.activeElement.blur();
  const before = S.pages.map(p => p.uid).join(',');
  S.objects = st.o; S.bates = st.b || null;
  S.pages = st.p.map(([u, r]) => { const p = PG(u); p.rot = r; return p; });
  const keep = new Set(S.pages.map(p => p.uid)); S.osel = new Set([...S.osel].filter(u => keep.has(u)));
  S.sel = null; S.editing = null; syncUndo(); markDirty();
  S.pages.forEach(p => { if (p.ocr) emit('ocr:refresh', p); });
  if (S.org) emit('org:render');
  else if (before !== S.pages.map(p => p.uid).join(',')) { buildPages(); emit('pages:changed'); }
  else layout();
  emit('ctx');
  if (S.lifts.length > (st.l || 0)) revertLifts(st.l || 0).catch(e => { console.error(e); toast('The page text could not be put back.'); });
}

/* ---------- editing text that is already on the page ---------- */
// Blocks of existing text per page: from the content stream (removable) or, for OCR words, text
// inside graphics and pages from inserted files, only coverable.
async function pageBlocks(p) {
  const ocrAt = p.ocr ? p.ocr.at : 0;
  if (p.edit && p.edit.ocrAt === ocrAt) return p.edit.blocks;
  if (p.editBusy) return null;
  p.editBusy = (async () => {
    const tc = await p.proxy.getTextContent({ includeMarkedContent: false });
    let blocks = [], an = null;
    const hasText = tc.items.some(it => it.str && it.str.trim());
    if (p.src === 0 && hasText) { const lib = await libDoc(); an = await analyzePage(lib, p.si, tc.items, tc.styles); blocks = an.blocks; }
    else if (hasText) blocks = buildBlocks(tc.items, tc.styles).map(b => Object.assign(b, { covered: true }));
    if (p.ocr && p.ocr.words.length) {
      const rot = p.ocr.rot, { c, s: sn } = frame(rot);
      const items = p.ocr.words.map(w => { const size = w.h * 1.15, b = offset(w.tl, rot, 0, w.h * 0.82); return { str: w.text + ' ', transform: [size * c, size * sn, -size * sn, size * c, b[0], b[1]], width: w.w, height: w.h, fontName: 'ocr' }; });
      blocks = blocks.concat(buildBlocks(items, { ocr: { ascent: 0.8, descent: 0.2 } }).map(b => Object.assign(b, { covered: true, ocr: true })));
    }
    p.edit = { blocks, an, ocrAt }; p.editBusy = null;
    if (lastMove && lastMove.target.closest && lastMove.target.closest('.pg') === p.sec) hoverMove(lastMove);
  })().catch(e => { console.warn('blocks', e); p.edit = { blocks: [], an: null, ocrAt }; p.editBusy = null; });
  return null;
}
let lastMove = null;
export function clearHover() { if (S.hover) { S.hover.box.remove(); S.hover = null; } }
function hoverMove(e) {
  lastMove = e;
  if (S.tool !== 'text' || S.editing != null || S.lifting || S.org || S.mode === 'sign') { clearHover(); return; }
  const sec = e.target.closest && e.target.closest('.pg'), p = sec && PG(+sec.dataset.uid);
  if (!p || !p.vp) { clearHover(); return; }
  const blocks = p.edit && p.edit.ocrAt === (p.ocr ? p.ocr.at : 0) ? p.edit.blocks : null;
  if (!blocks) { pageBlocks(p); clearHover(); return; }
  const bl = blockAt(blocks, toWorld(p, e));
  if (S.hover && (S.hover.bl !== bl || S.hover.p !== p || !S.hover.box.isConnected)) clearHover();
  if (bl && !S.hover) { const box = el('div', { class: 'liftbox', title: bl.covered ? 'Click to edit (the original is covered)' : 'Click to edit this text' }); place(box, p, blockRect(bl, 2, 1)); p.ol.append(box); S.hover = { p, bl, box }; }
}
const rendered = p => new Promise(res => { const t0 = performance.now(); const tick = () => { if ((p.key && !p.task) || !p.visible || performance.now() - t0 > 4000) res(); else setTimeout(tick, 40); }; tick(); });
async function commitLib() { const bytes = await S.lib.save({ updateFieldAppearances: false }); await reloadMain(bytes); }
async function revertLifts(n) { S.lifting = true; try { const lib = await libDoc(); while (S.lifts.length > n) restoreContents(lib, S.lifts.pop()); await commitLib(); } finally { S.lifting = false; } }
/* Take a block off the page and hand it to the editor as a text object. */
export async function liftBlock(p, bl) {
  if (S.lifting) return; S.lifting = true; clearHover();
  try {
    const fi = bl.fontInfo ? chooseFont(bl.fontInfo, FONTS) : { font: bl.ocr ? S.textStyle.font : 'helv', bold: false, italic: false };
    const o = { type: 'text', text: bl.text, size: Math.round(bl.size * 100) / 100, color: bl.color || '#111111', font: fi.font, bold: fi.bold, italic: fi.italic, underline: false, align: bl.align, list: 'none', lead: Math.round(bl.lead * 1000) / 1000 };
    const s0 = bl.s0 - PAD, top = bl.b1 + o.size * baselineAt(o, 0) + PAD, W = bl.s1 - bl.s0;
    Object.assign(o, { x: bl.u[0] * s0 + bl.n[0] * top, y: bl.u[1] * s0 + bl.n[1] * top, a: ((bl.angle % 360) + 360) % 360, w: W + 2 * PAD + 2 + W * 0.01 });
    // recognized words under the block (a scan that also carries a text layer, or an OCR block itself) go with it
    const inBlock = p.ocr ? p.ocr.words.map((w, i) => { const c = offset(w.tl, p.ocr.rot, w.w / 2, w.h / 2), sv = c[0] * bl.u[0] + c[1] * bl.u[1], bv = c[0] * bl.n[0] + c[1] * bl.n[1]; return sv >= bl.s0 - 1 && sv <= bl.s1 + 1 && bv >= bl.bBot - 1 && bv <= bl.bTop + 1 ? i : -1; }).filter(i => i >= 0) : [];
    const ocrIdx = [...new Set([...(bl.ocr ? bl.idxs : []), ...inBlock])];
    if (ocrIdx.length) o.ocrIdx = ocrIdx;
    pushUndo();
    if (!bl.covered && p.src === 0 && p.edit && p.edit.an) {
      // the old text is hidden at once; the page itself follows when the rewritten document has rendered
      const cover = el('div', { class: 'liftcover' }); place(cover, p, blockRect(bl, 1, 1)); p.sheet.append(cover);
      try { const lib = await libDoc(); S.lifts.push(removeBlock(lib, p.si, p.edit.an, bl)); await commitLib(); await rendered(p); } finally { cover.remove(); }
    }
    else { const r = blockRect(bl, 1, 1); addObj(p, { type: 'whiteout', x: r.x, y: r.y, w: r.w, h: r.h, a: r.a }); toast(bl.ocr ? 'Recognized text: the scanned words are covered with white and the text is typed on top.' : 'This text is part of a graphic, so it is covered with white and typed on top.', 5000); }
    const obj = addObj(p, o); if (ocrIdx.length) emit('ocr:refresh', p); setTool('select'); setTimeout(() => startEdit(obj), 0);
  } catch (e) { console.error(e); toast('That text could not be opened for editing.'); }
  finally { S.lifting = false; }
}

/* ---------- objects ---------- */
export const fieldLabel = o => `${{ signature: 'Signature', initials: 'Initials', date: 'Date signed', text: 'Text', checkbox: 'Checkbox' }[o.ftype] || o.ftype} ${o.signerName ? '· ' + o.signerName : ''}`;
export function renderObjs(p) {
  if (!p || !p.ol || !p.vp) return;
  p.ol.innerHTML = '';
  for (const o of S.objects) if (o.page === p.uid) p.ol.append(objEl(p, o));
  emit('objs:rendered', p);
}
export function renderAllObjs() { S.pages.forEach(renderObjs); }
function objEl(p, o) {
  const d = el('div', { class: 'obj obj-' + o.type + (S.sel === o.id ? ' sel' : '') + (o.type === 'field' ? ' sc' + ((o.signer % 5) + 1) : ''), dataset: { id: o.id } });
  if (o.type === 'text') {
    const t = el('div', { class: 'txt', text: displayText(o), style: { fontSize: o.size * S.scale + 'px', color: o.color, padding: 2 * S.scale + 'px', lineHeight: String(o.lead || LINE) } });
    if (!o.box) applyStyle(t, o);
    if (o.box) { d.classList.add('boxed'); t.style.borderWidth = Math.max(1, 1.5 * S.scale) + 'px'; t.style.borderColor = o.color; t.style.padding = `${3 * S.scale}px ${6 * S.scale}px`; }
    d.append(t); d.addEventListener('dblclick', () => startEdit(o));
  } else if (o.type === 'image') d.append(el('img', { src: o.src, alt: 'Signature', draggable: 'false' }));
  else if (o.type === 'check') d.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="12,55 40,82 90,18" fill="none" stroke="${o.color}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  else if (o.type === 'field') d.append(el('span', { class: 'fl', text: fieldLabel(o) }));
  else if (o.type === 'note') {
    d.innerHTML = noteSvg(o.color); d.title = (o.text || '').slice(0, 200);
    if (S.sel === o.id) {
      const pop = el('div', { class: 'notepop' });
      const author = el('input', { class: 'nauthor', type: 'text', value: o.author || '', placeholder: 'Your name', 'aria-label': 'Author' });
      author.addEventListener('change', () => { o.author = author.value.trim(); S.author = o.author; try { localStorage.setItem('pdfview.author', o.author); } catch {} markDirty(); });
      const ta = el('textarea', { class: 'ntext', placeholder: 'Type the note', 'aria-label': 'Note text', rows: '4' }); ta.value = o.text || '';
      let pushed = false; ta.addEventListener('input', () => { if (!pushed) { pushUndo(); pushed = true; } o.text = ta.value; d.title = o.text.slice(0, 200); markDirty(); });
      pop.addEventListener('pointerdown', ev => ev.stopPropagation()); pop.addEventListener('dblclick', ev => ev.stopPropagation());
      pop.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); select(null); } });
      pop.append(el('div', { class: 'nhead' }, author, el('span', { class: 'ndate', text: o.created ? new Date(o.created).toLocaleDateString() : '' })), ta);
      d.append(pop);
      delete o.fresh; setTimeout(() => { if (d.isConnected && !d.contains(document.activeElement)) ta.focus(); }, 0);
    }
  }
  else if (o.type === 'shape') d.innerHTML = shapeSvg(o, S.scale);
  else if (o.type === 'ink') {
    d.classList.add(o.mode === 'marker' ? 'marker' : o.mode === 'erase' ? 'erase' : 'pen');
    const pts = o.pts.map(([x, y]) => `${(x - o.x).toFixed(2)},${(o.y - y).toFixed(2)}`).join(' ');
    d.innerHTML = `<svg viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${o.color}" stroke-width="${o.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${o.mode === 'marker' ? .42 : 1}" vector-effect="non-scaling-stroke" style="stroke-width:${o.width * S.scale}px"/></svg>`;
  }
  place(d, p, o);
  if (S.sel === o.id && !o.box && o.type !== 'ink' && o.type !== 'note') { const h = el('div', { class: 'hdl', title: o.type === 'text' ? 'Drag to set the box width (text wraps inside it)' : 'Drag to resize' }); h.addEventListener('pointerdown', e => resizeDown(p, o, d, e)); d.append(h); }
  d.addEventListener('pointerdown', e => objDown(p, o, e));
  return d;
}
export function select(id) {
  const prev = S.sel != null && S.sel !== id ? S.objects.find(x => x.id === S.sel) : null;
  if (prev && prev.type === 'note' && !(prev.text || '').trim()) S.objects = S.objects.filter(x => x !== prev); // an empty note is dropped when left
  S.sel = id; renderAllObjs(); emit('ctx');
}
const noteSvg = color => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 4.5a1.5 1.5 0 0 1 1.5-1.5h14a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-8.2L6 20.5V16H5a1.5 1.5 0 0 1-1.5-1.5z" fill="${color || '#ffd400'}" stroke="#6b5300" stroke-width="1.1"/><path d="M7.5 8h9M7.5 11.5h6" stroke="#6b5300" stroke-width="1.2" stroke-linecap="round"/></svg>`;
const findEl = (p, o) => p.ol.querySelector(`[data-id="${o.id}"]`);
function objDown(p, o, e) {
  if (e.button > 0) return; e.stopPropagation();
  if (S.editing === o.id) return;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  if (S.tool !== 'select' && S.tool !== 'field') setTool('select');
  const wasSel = S.sel === o.id; if (!wasSel) select(o.id);
  e.preventDefault();
  const start = toWorld(p, e), ox = o.x, oy = o.y; let moved = false;
  const mv = ev => {
    if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
    if (!moved) { pushUndo(); moved = true; }
    const w = toWorld(p, ev); o.x = ox + w[0] - start[0]; o.y = oy + w[1] - start[1];
    const d = findEl(p, o); if (d) place(d, p, o);
  };
  const up = ev => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    if (moved) { markDirty(); emit('obj:moved', o); }
    else if (wasSel && o.type === 'text' && ev.type === 'pointerup') setTimeout(() => startEdit(o), 0);
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
function resizeDown(p, o, d, e) {
  e.stopPropagation(); e.preventDefault(); pushUndo();
  const mv = ev => {
    const P = toWorld(p, ev), { c, s } = frame(o.a), dx = P[0] - o.x, dy = P[1] - o.y;
    const u = dx * c + dy * s, v = dx * s - dy * c;
    if (o.type === 'text') { o.w = Math.max(24, u); const cur0 = findEl(p, o); if (cur0) { place(cur0, p, o); applyStyle(cur0.querySelector('.txt'), o); } return; }
    o.w = Math.max(6, u);
    o.h = (o.type === 'image' || o.type === 'check') ? o.w * o.ar : Math.max(3, v);
    const cur = findEl(p, o); if (cur) place(cur, p, o);
  };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); markDirty(); emit('obj:moved', o); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
export function startEdit(o) {
  const p = PG(o.page); if (!p || !p.ol) return;
  if (S.sel !== o.id) select(o.id);
  const d = findEl(p, o); if (!d) return; const t = d.querySelector('.txt');
  S.editing = o.id; if (!o.box) { t.textContent = o.text; t.classList.remove('list'); t.style.paddingLeft = ''; t.style.textIndent = ''; }
  try { t.contentEditable = 'plaintext-only'; } catch { t.contentEditable = 'true'; }
  if (t.contentEditable !== 'plaintext-only') t.contentEditable = 'true';
  let pushed = false;
  t.addEventListener('input', () => { if (!pushed) { pushUndo(); pushed = true; } o.text = t.innerText.replace(/\n$/, ''); markDirty(); });
  t.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); t.blur(); return; }
    const k = (ev.ctrlKey || ev.metaKey) && !o.box ? { b: 'bold', i: 'italic', u: 'underline' }[ev.key.toLowerCase()] : null;
    if (k) { ev.preventDefault(); if (!pushed) { pushUndo(); pushed = true; } o[k] = !o[k]; applyStyle(t, o); markDirty(); emit('ctx'); }
  });
  t.addEventListener('paste', ev => { ev.preventDefault(); document.execCommand('insertText', false, (ev.clipboardData || window.clipboardData).getData('text/plain')); });
  t.addEventListener('blur', () => {
    t.contentEditable = 'false'; S.editing = null; o.text = t.innerText.replace(/\n$/, '');
    if (!o.text.trim()) { S.objects = S.objects.filter(x => x !== o); if (S.sel === o.id) S.sel = null; if (o.ocrIdx) emit('ocr:refresh', p); }
    renderObjs(p); emit('ctx');
  }, { once: true });
  t.focus();
  const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  emit('ctx');
}
export function addObj(p, o) { o.id = nextUid(); o.page = p.uid; S.objects.push(o); S.sel = o.id; renderObjs(p); markDirty(); emit('ctx'); emit('obj:added', o); return o; }
export function removeSel() {
  if (S.sel == null) return; pushUndo(); { const o = S.objects.find(x => x.id === S.sel); if (o && o.ocrIdx) { const p = PG(o.page); setTimeout(() => emit('ocr:refresh', p), 0); } }
  const o = S.objects.find(x => x.id === S.sel); S.objects = S.objects.filter(x => x.id !== S.sel); S.sel = null;
  if (o) { renderObjs(PG(o.page)); emit('obj:removed', o); } markDirty(); emit('ctx');
}
export const fieldHooks = { make: null }; // the envelope composer fills this when the field tool is active

function sheetDown(p, e) {
  if (e.button > 0 || S.mode === 'sign') return;
  const P = toWorld(p, e), R = rotOf(p), tool = S.tool;
  if (tool === 'select') { if (S.sel != null) select(null); return; }
  if ((tool === 'highlight' || tool === 'whiteout' || tool === 'redact') && e.target.matches('.textLayer span, .ocrLayer span')) {
    // started on a word: let the browser select text, then mark the selection on release
    const up = () => { removeEventListener('pointerup', up); removeEventListener('pointercancel', up); setTimeout(() => { if (!markSelection(tool)) getSelection()?.removeAllRanges(); }, 0); };
    addEventListener('pointerup', up); addEventListener('pointercancel', up); return;
  }
  e.preventDefault();
  if (tool === 'text') {
    const bl = S.hover && S.hover.p === p ? S.hover.bl : (p.edit ? blockAt(p.edit.blocks, P) : null);
    if (bl) { liftBlock(p, bl); return; }
    pushUndo(); const tl = offset(P, R, -2, -(S.tsize * 0.75 + 2));
    const o = addObj(p, Object.assign({ type: 'text', x: tl[0], y: tl[1], a: R, text: '', size: S.tsize, color: S.tcolor }, S.textStyle));
    setTool('select'); setTimeout(() => startEdit(o), 0);
  } else if (tool === 'stamp') {
    pushUndo(); const text = S.stamp || STAMPS[0], size = 14; const tl = offset(P, R, -(text.length * size * 0.33), -(size * 0.9));
    addObj(p, { type: 'text', box: true, x: tl[0], y: tl[1], a: R, text, size, color: S.tcolor === '#111111' ? '#b3261e' : S.tcolor });
    setTool('select');
  } else if (tool === 'note') {
    pushUndo(); const z = 18, tl = offset(P, R, -z / 2, -z / 2);
    addObj(p, { type: 'note', x: tl[0], y: tl[1], w: z, h: z, a: R, text: '', author: S.author || '', color: S.noteColor, created: new Date().toISOString(), fresh: true });
    setTool('select');
  } else if (tool === 'check') {
    pushUndo(); const z = 12, tl = offset(P, R, -z / 2, -z / 2);
    addObj(p, { type: 'check', x: tl[0], y: tl[1], w: z, h: z, ar: 1, a: R, color: S.tcolor });
  } else if (tool === 'sign') {
    if (!S.sig) { openSig().then(sig => { if (sig) { S.sig = sig; toast('Click on the page where the signature goes.'); } else setTool('select'); }); return; }
    pushUndo(); const w = 150, h = w * S.sig.ar, tl = offset(P, R, -w / 2, -h / 2);
    addObj(p, { type: 'image', x: tl[0], y: tl[1], w, h, ar: S.sig.ar, a: R, src: S.sig.url });
    setTool('select');
  } else if (tool === 'field') {
    if (!fieldHooks.make) return; const f = fieldHooks.make(); if (!f) return;
    pushUndo(); const tl = offset(P, R, -f.w / 2, -f.h / 2);
    addObj(p, Object.assign({ type: 'field', x: tl[0], y: tl[1], a: R }, f));
  } else if (tool === 'draw' || tool === 'erase') {
    e.preventDefault(); if (e.target.setPointerCapture) { try { p.sheet.setPointerCapture(e.pointerId); } catch {} }
    const mode = tool === 'erase' ? 'erase' : S.ink.mode, width = tool === 'erase' ? S.ink.eraseWidth : S.ink.width, color = mode === 'erase' ? '#ffffff' : mode === 'marker' ? S.ink.markerColor : S.ink.penColor;
    const pts = [P]; const svg = el('div', { class: 'obj obj-ink ghost ' + mode }); p.ol.append(svg);
    const draw = () => { const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); const x0 = Math.min(...xs) - width, x1 = Math.max(...xs) + width, y0 = Math.min(...ys) - width, y1 = Math.max(...ys) + width; const o = { x: x0, y: y1, w: x1 - x0, h: y1 - y0, a: 0 }; place(svg, p, o); svg.innerHTML = `<svg viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none"><polyline points="${pts.map(([x, y]) => `${x - x0},${y1 - y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${mode === 'marker' ? .42 : 1}" vector-effect="non-scaling-stroke" style="stroke-width:${width * S.scale}px"/></svg>`; };
    draw();
    const mv = ev => { const q = toWorld(p, ev); if (ev.shiftKey) { pts.length = 1; pts.push(q); draw(); return; } const l = pts[pts.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) < 1.2) return; pts.push(q); draw(); };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); svg.remove();
      if (pts.length < 2) pts.push([P[0] + 0.5, P[1]]);
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); const x0 = Math.min(...xs) - width, x1 = Math.max(...xs) + width, y0 = Math.min(...ys) - width, y1 = Math.max(...ys) + width;
      pushUndo(); const o = addObj(p, { type: 'ink', mode, width, color, pts, x: x0, y: y1, w: x1 - x0, h: y1 - y0, a: 0 }); S.sel = null; renderObjs(p); emit('ctx');
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  } else if (tool === 'shape') {
    const g = el('div', { class: 'obj obj-shape ghost' }); p.ol.append(g);
    const kind = S.shape.kind, width = S.shape.width, color = S.shape.color;
    let r = rectFrom(P, P, R), dir = [0, 0, 1, 1];
    const upd = ev => { let E = toWorld(p, ev); const { c, s } = frame(R); let u = (E[0] - P[0]) * c + (E[1] - P[1]) * s, v = (E[0] - P[0]) * s - (E[1] - P[1]) * c;
      if (ev.shiftKey) { if (kind === 'line' || kind === 'arrow') { const len = Math.hypot(u, v), ang = Math.round(Math.atan2(v, u) / (Math.PI / 4)) * (Math.PI / 4); u = len * Math.cos(ang); v = len * Math.sin(ang); if (Math.abs(u) < 1e-6) u = 0; if (Math.abs(v) < 1e-6) v = 0; } else { const m = Math.max(Math.abs(u), Math.abs(v)); u = Math.sign(u || 1) * m; v = Math.sign(v || 1) * m; } E = offset(P, R, u, v); }
      r = rectFrom(P, E, R); dir = u < 0 ? [1, v < 0 ? 1 : 0, 0, v < 0 ? 0 : 1] : [0, v < 0 ? 1 : 0, 1, v < 0 ? 0 : 1]; const o = Object.assign({ kind, width, color, dir }, r); place(g, p, o); g.innerHTML = shapeSvg(o, S.scale); };
    const mv = ev => upd(ev);
    const up = ev => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); g.remove();
      if (r.w < 2 && r.h < 2) return;
      if (kind === 'rect' || kind === 'ellipse') { r.w = Math.max(r.w, 2); r.h = Math.max(r.h, 2); }
      pushUndo(); addObj(p, Object.assign({ type: 'shape', kind, width, color, dir }, r));
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  } else if (tool === 'snap') {
    e.preventDefault(); clearSnap();
    const g = el('div', { class: 'obj snapbox ghost' }); p.ol.append(g);
    let r = rectFrom(P, P, R); place(g, p, r);
    const mv = ev => { r = rectFrom(P, toWorld(p, ev), R); place(g, p, r); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); if (r.w < 4 || r.h < 4) { g.remove(); return; } S.snap = { p, r, box: g }; takeSnapshot('image'); emit('ctx'); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  } else if (tool === 'highlight' || tool === 'whiteout' || tool === 'redact') {
    const g = el('div', { class: 'obj obj-' + tool + ' ghost' }); p.ol.append(g);
    let r = rectFrom(P, P, R); place(g, p, r);
    const mv = ev => { r = rectFrom(P, toWorld(p, ev), R); place(g, p, r); };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); g.remove();
      if (r.w < 3 && r.h < 3) { const tl = offset(P, R, -4, -8); r = { x: tl[0], y: tl[1], w: 110, h: 16, a: R }; }
      pushUndo(); addObj(p, Object.assign({ type: tool }, r));
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }
}
/* ---------- shapes ---------- */
export function shapeSvg(o, scale) {
  const sw = o.width * scale, st = `stroke="${o.color}" stroke-width="${o.width}" vector-effect="non-scaling-stroke" style="stroke-width:${sw}px" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const [sx, sy, ex, ey] = o.dir || [0, 0, 1, 1]; const x1 = sx * o.w, y1 = sy * o.h, x2 = ex * o.w, y2 = ey * o.h;
  let body = '';
  if (o.kind === 'rect') body = `<rect x="0" y="0" width="${o.w}" height="${o.h}" ${st}/>`;
  else if (o.kind === 'ellipse') body = `<ellipse cx="${o.w / 2}" cy="${o.h / 2}" rx="${o.w / 2}" ry="${o.h / 2}" ${st}/>`;
  else {
    body = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${st}/>`;
    if (o.kind === 'arrow') { const ang = Math.atan2(y2 - y1, x2 - x1), L = Math.max(6, o.width * 4.5), a = Math.PI / 7; const hx = [x2 - L * Math.cos(ang - a), x2 - L * Math.cos(ang + a)], hy = [y2 - L * Math.sin(ang - a), y2 - L * Math.sin(ang + a)]; body += `<polyline points="${hx[0]},${hy[0]} ${x2},${y2} ${hx[1]},${hy[1]}" ${st}/>`; }
  }
  return `<svg viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none">${body}</svg>`;
}
/* ---------- snapshot: copy part of a page as an image or its text ---------- */
function clearSnap() { if (S.snap?.box) S.snap.box.remove(); S.snap = null; }
function snapCanvas() {
  const { p, r } = S.snap; const dpr = p.canvas.width / p.vp.width;
  const corners = [[0, 0], [r.w, 0], [r.w, r.h], [0, r.h]].map(([u, v]) => p.vp.convertToViewportPoint(...offset([r.x, r.y], r.a, u, v)));
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]); const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys)), w = Math.min(p.vp.width, Math.max(...xs)) - x, h = Math.min(p.vp.height, Math.max(...ys)) - y;
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(p.canvas, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, c.width, c.height);
  return c;
}
async function snapText() {
  const { p, r } = S.snap; const { pageText } = await import('./search.js'); const t = await pageText(p);
  const inside = (x, y) => { const { c, s } = frame(r.a); const dx = x - r.x, dy = y - r.y; const u = dx * c + dy * s, v = dx * s - dy * c; return u >= -1 && u <= r.w + 1 && v >= -1 && v <= r.h + 1; };
  let out = ''; for (const it of t.items) { if (!it.transform) continue; const x = it.transform[4], y = it.transform[5] + (it.height || 8) / 2; if (!inside(x, y)) continue; out += it.str; if (it.hasEOL) out += '\n'; }
  return out.replace(/[ \t]+\n/g, '\n').trim();
}
export async function takeSnapshot(kind) {
  if (!S.snap) return;
  try {
    if (kind === 'image' || kind === 'png') {
      const c = snapCanvas(); const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      if (kind === 'png' || !navigator.clipboard?.write || !window.ClipboardItem) { const a = el('a', { href: URL.createObjectURL(blob), download: (S.name.replace(/\.pdf$/i, '') || 'page') + '-snapshot.png' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast(kind === 'png' ? 'Snapshot saved as a PNG file.' : 'Clipboard images are not available here; the snapshot was saved as a PNG file instead.'); }
      else { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Snapshot copied as an image. Paste it into Word, email or anywhere else.'); }
    } else if (kind === 'text') {
      const t = await snapText(); if (!t) { toast('No text in that area. If it is a scan, run OCR first.'); return; }
      await navigator.clipboard.writeText(t); toast(`Copied ${t.split(/\s+/).length} words of text.`);
    }
  } catch (e) { console.error(e); toast('The snapshot could not be copied: ' + (e.message || e)); }
}
// Highlight (or white-out / redact) whatever text is currently selected in the text layer.
export function markSelection(type) {
  const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const rects = [...sel.getRangeAt(0).getClientRects()]; if (!rects.length) return false;
  const byPage = new Map();
  for (const r of rects) {
    if (r.width < 1 || r.height < 1) continue;
    const sheet = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.sheet'); if (!sheet) continue;
    const p = PG(+sheet.parentElement.dataset.uid); if (!p) continue;
    if (!byPage.has(p)) byPage.set(p, []); byPage.get(p).push(r);
  }
  if (!byPage.size) return false;
  pushUndo();
  for (const [p, rs] of byPage) {
    const R = rotOf(p), sr = p.sheet.getBoundingClientRect();
    // merge rects on the same line
    const lines = [];
    for (const r of rs.sort((a, b) => a.top - b.top || a.left - b.left)) { const L = lines.find(l => Math.abs(l.top - r.top) < r.height * .5); if (L) { L.left = Math.min(L.left, r.left); L.right = Math.max(L.right, r.right); L.bottom = Math.max(L.bottom, r.bottom); } else lines.push({ top: r.top, left: r.left, right: r.right, bottom: r.bottom }); }
    for (const L of lines) {
      const P0 = p.vp.convertToPdfPoint(L.left - sr.left, L.top - sr.top), P1 = p.vp.convertToPdfPoint(L.right - sr.left, L.bottom - sr.top);
      const o = rectFrom(P0, P1, R); if (o.w < 1 || o.h < 1) continue;
      o.id = nextUid(); o.page = p.uid; o.type = type; S.objects.push(o);
    }
    renderObjs(p);
  }
  sel.removeAllRanges(); markDirty(); emit('ctx'); return true;
}

/* ---------- tools ---------- */
export function setTool(t) {
  if (t !== 'select' && (!S.doc || S.org)) return;
  if (t === 'sign' && !S.sig) { openSig().then(sig => { if (sig) { S.sig = sig; setTool('sign'); toast('Click on the page where the signature goes.'); } }); return; }
  if (S.tool === 'snap' && t !== 'snap') clearSnap();
  if (t !== 'text') clearHover();
  S.tool = t; document.body.dataset.tool = t;
  $$('#tools [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  if (t !== 'select' && S.sel != null) { S.sel = null; renderAllObjs(); }
  emit('ctx');
}
const COLORS = [['#111111', 'Black'], ['#1a3a8f', 'Blue'], ['#b3261e', 'Red']];
const today = () => new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
export const STAMPS = ['EXHIBIT A', 'EXHIBIT B', 'EXHIBIT 1', 'FILED', 'RECEIVED ' + today(), 'CONFIDENTIAL', 'COPY', 'DRAFT', 'COMPOSITE EXHIBIT'];
function renderCtx(c) {
  const o = S.sel != null && S.objects.find(x => x.id === S.sel);
  if (!o) {
    if (S.tool === 'sign' && S.sig) { c.append(el('span', { text: 'Click on the page to place your signature.' }), el('button', { class: 'mini', type: 'button', text: 'Change signature', onclick: () => openSig().then(s => { if (s) S.sig = s; }) })); return true; }
    if (S.tool === 'stamp') {
      c.append(el('span', { text: 'Stamp:' }));
      const sel = el('select', { class: 'ctl', id: 'stampPick', 'aria-label': 'Stamp wording' }); STAMPS.forEach(t => sel.append(el('option', { value: t, text: t }))); sel.append(el('option', { value: '', text: 'Custom…' }));
      sel.value = STAMPS.includes(S.stamp) ? S.stamp : S.stamp ? '' : STAMPS[0];
      const custom = el('input', { class: 'ctl', id: 'stampText', placeholder: 'Stamp wording', value: STAMPS.includes(S.stamp) ? '' : (S.stamp || ''), hidden: sel.value !== '' });
      sel.addEventListener('change', () => { custom.hidden = sel.value !== ''; if (sel.value) S.stamp = sel.value; else { S.stamp = custom.value.trim() || 'STAMP'; custom.focus(); } });
      custom.addEventListener('input', () => { S.stamp = custom.value.trim() || 'STAMP'; });
      c.append(sel, custom, el('span', { text: 'then click on the page to place it.' })); return true;
    }
    if (S.tool === 'highlight' || S.tool === 'whiteout' || S.tool === 'redact') { c.append(el('span', { text: `Drag a box on the page, or select text and press ${S.tool === 'highlight' ? 'H' : S.tool === 'whiteout' ? 'W' : 'R'} again to mark the selection.` })); return true; }
    if (S.tool === 'draw') {
      c.append(el('span', { class: 'lbl', text: 'Marker' }));
      const mode = el('select', { class: 'ctl', 'aria-label': 'Marker type' }); [['marker', 'Highlighter (see-through)'], ['pen', 'Pen (solid)']].forEach(([v, t]) => mode.append(el('option', { value: v, text: t }))); mode.value = S.ink.mode; mode.addEventListener('change', () => { S.ink.mode = mode.value; emit('ctx'); });
      const width = el('select', { class: 'ctl', 'aria-label': 'Thickness' }); [[2, 'Thin'], [4, 'Medium'], [8, 'Thick'], [14, 'Wide']].forEach(([v, t]) => width.append(el('option', { value: v, text: t }))); width.value = S.ink.width; width.addEventListener('change', () => { S.ink.width = +width.value; });
      const colors = S.ink.mode === 'marker' ? [['#ffd400', 'Yellow'], ['#7cf27c', 'Green'], ['#7cc4ff', 'Blue'], ['#ff9ad5', 'Pink']] : [['#111111', 'Black'], ['#1a3a8f', 'Blue'], ['#b3261e', 'Red']];
      const cur = S.ink.mode === 'marker' ? S.ink.markerColor : S.ink.penColor;
      c.append(mode, width); colors.forEach(([hex, name]) => { const b = el('button', { class: 'sw', type: 'button', title: name, 'aria-label': name, 'aria-pressed': String(cur === hex), style: { background: hex } }); b.addEventListener('click', () => { if (S.ink.mode === 'marker') S.ink.markerColor = hex; else S.ink.penColor = hex; emit('ctx'); }); c.append(b); });
      c.append(el('span', { text: 'Draw on the page. Each stroke can be moved or deleted afterwards.' })); return true;
    }
    if (S.tool === 'shape') {
      c.append(el('span', { class: 'lbl', text: 'Shapes' }));
      const kind = el('select', { class: 'ctl', id: 'shapeKind', 'aria-label': 'Shape' }); [['line', 'Line'], ['arrow', 'Arrow'], ['rect', 'Rectangle'], ['ellipse', 'Circle or ellipse']].forEach(([v, t]) => kind.append(el('option', { value: v, text: t }))); kind.value = S.shape.kind; kind.addEventListener('change', () => { S.shape.kind = kind.value; });
      const width = el('select', { class: 'ctl', 'aria-label': 'Line thickness' }); [[1, 'Hairline'], [2, 'Thin'], [3, 'Medium'], [5, 'Thick']].forEach(([v, t]) => width.append(el('option', { value: v, text: t }))); width.value = S.shape.width; width.addEventListener('change', () => { S.shape.width = +width.value; });
      c.append(kind, width); COLORS.forEach(([hex, name]) => { const b = el('button', { class: 'sw', type: 'button', title: name, 'aria-label': name, 'aria-pressed': String(S.shape.color === hex), style: { background: hex } }); b.addEventListener('click', () => { S.shape.color = hex; emit('ctx'); }); c.append(b); });
      const pick = el('input', { type: 'color', class: 'colorpick', value: S.shape.color, title: 'Any color' }); pick.addEventListener('change', () => { S.shape.color = pick.value; emit('ctx'); }); c.append(pick, el('span', { text: 'Hold Shift for a straight or square shape. Drag on the page to draw it. Shapes can be moved and resized afterwards.' })); return true;
    }
    if (S.tool === 'erase') {
      c.append(el('span', { class: 'lbl', text: 'Eraser' }));
      const width = el('select', { class: 'ctl', 'aria-label': 'Eraser size' }); [[4, 'Small'], [10, 'Medium'], [20, 'Large'], [40, 'Very large']].forEach(([v, t]) => width.append(el('option', { value: v, text: t }))); width.value = S.ink.eraseWidth; width.addEventListener('change', () => { S.ink.eraseWidth = +width.value; });
      c.append(width, el('span', { text: 'Drag over the part you want gone. It is painted white in the saved copy, so it suits white paper; use Redact when the content must be removed for good.' })); return true;
    }
    if (S.tool === 'snap') {
      c.append(el('span', { class: 'lbl', text: 'Snapshot' }));
      if (S.snap) c.append(el('button', { class: 'mini', type: 'button', id: 'snapImg', text: 'Copy image', onclick: () => takeSnapshot('image') }), el('button', { class: 'mini', type: 'button', id: 'snapTxt', text: 'Copy text', onclick: () => takeSnapshot('text') }), el('button', { class: 'mini', type: 'button', id: 'snapPng', text: 'Save PNG', onclick: () => takeSnapshot('png') }), el('button', { class: 'mini', type: 'button', text: 'Clear', onclick: () => { clearSnap(); emit('ctx'); } }));
      else c.append(el('span', { text: 'Drag a box around the part of the page you want. It is copied as an image right away; the text in it can be copied too.' }));
      return true;
    }
    if (S.tool === 'text') {
      c.append(el('span', { class: 'lbl', text: 'Text' }));
      const target = Object.assign({ size: S.tsize, color: S.tcolor }, S.textStyle);
      textToolbar(c, target, { isDefault: true, onChange: mut => { mut(target); S.tsize = target.size; S.tcolor = target.color; const { size, color, ...rest } = target; S.textStyle = rest; emit('ctx'); } });
      c.append(el('span', { class: 'hint', text: 'Click text on the page to edit it, or click an empty spot to add text.' }));
      return true;
    }
    return false;
  }
  c.append(el('span', { class: 'lbl', text: { text: o.box ? 'Stamp' : 'Text', check: 'Check mark', image: 'Signature', highlight: 'Highlight', note: 'Note', whiteout: 'White-out', redact: 'Redaction', field: 'Signature field', ink: o.mode === 'marker' ? 'Marker stroke' : o.mode === 'erase' ? 'Eraser stroke' : 'Pen stroke', shape: { line: 'Line', arrow: 'Arrow', rect: 'Rectangle', ellipse: 'Ellipse' }[o.kind] }[o.type] }));
  if (o.type === 'redact') c.append(el('span', { text: 'Content under this box is permanently removed when you save.', style: { color: 'var(--redline)' } }));
  if (o.type === 'note') { [['#ffd400', 'Yellow'], ['#8fd3ff', 'Blue'], ['#b6f2a1', 'Green'], ['#ffb3c7', 'Pink']].forEach(([hex, name]) => { const b = el('button', { class: 'sw', type: 'button', title: name, 'aria-label': name, 'aria-pressed': String(o.color === hex), style: { background: hex } }); b.addEventListener('pointerdown', e => e.preventDefault()); b.addEventListener('click', () => { pushUndo(); o.color = hex; S.noteColor = hex; renderObjs(PG(o.page)); markDirty(); emit('ctx'); }); c.append(b); }); c.append(el('span', { class: 'hint', text: 'Saved as a comment that Adobe and other viewers show. Drag the icon to move it.' })); }
  if (o.type === 'text' && !o.box) {
    textToolbar(c, o, { onChange: mut => { pushUndo(); mut(o); S.tsize = o.size; S.tcolor = o.color; const { font, bold, italic, underline, align, list } = o; S.textStyle = { font, bold, italic, underline, align, list }; const wasEditing = S.editing === o.id; renderObjs(PG(o.page)); markDirty(); emit('ctx'); if (wasEditing) startEdit(o); } });
    if (S.editing !== o.id) c.append(el('button', { class: 'mini', type: 'button', text: 'Edit text', onclick: () => startEdit(o) }));
  } else if (o.type === 'text') {
    const sz = el('select', { class: 'ctl', 'aria-label': 'Text size' });
    [8, 9, 10, 11, 12, 14, 16, 18, 24, 32].forEach(n => sz.append(el('option', { value: n, text: n + ' pt' })));
    sz.value = o.size; sz.addEventListener('change', () => { pushUndo(); o.size = +sz.value; renderObjs(PG(o.page)); markDirty(); }); c.append(sz);
  }
  if (o.type === 'shape' || (o.type === 'ink' && o.mode !== 'erase')) {
    const width = el('select', { class: 'ctl', 'aria-label': 'Thickness' }); [1, 2, 3, 4, 5, 8, 14].forEach(v => width.append(el('option', { value: v, text: v + ' pt' }))); width.value = o.width; width.addEventListener('change', () => { pushUndo(); o.width = +width.value; renderObjs(PG(o.page)); markDirty(); });
    const pick = el('input', { type: 'color', class: 'colorpick', value: o.color, title: 'Color' }); pick.addEventListener('change', () => { pushUndo(); o.color = pick.value; renderObjs(PG(o.page)); markDirty(); });
    c.append(width, pick);
  }
  if ((o.type === 'text' && o.box) || o.type === 'check') {
    COLORS.forEach(([hex, name]) => { const b = el('button', { class: 'sw', type: 'button', title: name, 'aria-label': name, 'aria-pressed': String(o.color === hex), style: { background: hex } }); b.addEventListener('pointerdown', e => e.preventDefault()); b.addEventListener('click', () => { pushUndo(); o.color = hex; S.tcolor = hex; renderObjs(PG(o.page)); markDirty(); emit('ctx'); }); c.append(b); });
    if (o.type === 'text' && S.editing !== o.id) c.append(el('button', { class: 'mini', type: 'button', text: 'Edit wording', onclick: () => startEdit(o) }));
  }
  if (o.type === 'image') c.append(el('button', { class: 'mini', type: 'button', text: 'Change signature', onclick: () => openSig().then(s => { if (!s) return; pushUndo(); S.sig = s; o.src = s.url; o.ar = s.ar; o.h = o.w * o.ar; renderObjs(PG(o.page)); markDirty(); }) }));
  if (o.type === 'field') emit('ctx:field', { c, o });
  const d = el('button', { class: 'mini danger', type: 'button', text: 'Delete', onclick: removeSel }); d.addEventListener('pointerdown', e => e.preventDefault()); c.append(d);
  return true;
}
function pageBar(p, n) {
  const act = el('span', { class: 'pg-actions' });
  const b = (icon, title, fn, cls = 'ib') => { const x = el('button', { class: cls, title, 'aria-label': title + ' ' + n, html: ICON[icon] }); x.addEventListener('click', fn); return x; };
  act.append(b('rl', 'Rotate page left', () => { pushUndo(); markDirty(); rotatePage(p, 270); emit('pages:changed'); }), b('rr', 'Rotate page right', () => { pushUndo(); markDirty(); rotatePage(p, 90); emit('pages:changed'); }),
    b('del', 'Delete page', () => {
      if (S.pages.length <= 1) { toast('A PDF needs at least one page.'); return; }
      pushUndo(); markDirty(); S.pages = S.pages.filter(x => x !== p);
      const so = S.objects.find(x => x.id === S.sel); if (so && so.page === p.uid) S.sel = null;
      const top = scroller().scrollTop; buildPages(); scroller().scrollTop = top; emit('pages:changed'); emit('ctx');
      toast(`Deleted page ${n}. Use Undo to bring it back.`);
    }, 'ib danger'));
  return act;
}

export function init() {
  initSignature();
  setHooks({ pageBar, onSheetDown: sheetDown, afterLayoutPage: p => renderObjs(p) });
  ctxHooks.render = renderCtx;
  $$('#tools [data-tool]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tool;
    if ((t === 'highlight' || t === 'whiteout' || t === 'redact') && markSelection(t)) return;
    setTool(t);
  }));
  $('#undoBtn').addEventListener('click', undo); $('#redoBtn').addEventListener('click', redo);
  $('#pages').addEventListener('pointermove', hoverMove); $('#pages').addEventListener('pointerleave', clearHover);
  on('doc:open', () => { setTool('select'); clearHover(); syncUndo(); $('#flatten').disabled = false; });
  on('tab:switch', () => { setTool('select'); clearHover(); syncUndo(); $('#flatten').disabled = false; renderAllObjs(); });
  on('select:obj', id => { if (S.objects.some(o => o.id === id)) select(id); });
  on('doc:close', () => { setTool('select'); $('#flatten').disabled = true; $('#flatten').checked = false; });
  keyHooks.push((e, { typing, mod }) => {
    if (anyModalOpen() || S.mode === 'sign') return false;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return true; }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return true; }
    if (typing || S.org) return false;
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel != null) { e.preventDefault(); removeSel(); return true; }
    if (e.key === 'Escape') { if (S.sel != null) select(null); else setTool('select'); return true; }
    if (mod || e.altKey) return false;
    const k = { v: 'select', t: 'text', m: 'stamp', k: 'check', s: 'sign', h: 'highlight', c: 'note', d: 'draw', a: 'shape', e: 'erase', w: 'whiteout', r: 'redact', n: 'snap' }[e.key.toLowerCase()];
    if (k && S.doc) { if ((k === 'highlight' || k === 'whiteout' || k === 'redact') && markSelection(k)) return true; setTool(k); return true; }
    return false;
  });
}

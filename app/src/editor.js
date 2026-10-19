// Editing: placed objects (text, check marks, signatures, highlight, white-out, redaction boxes,
// signature fields for envelopes), selection, drag, resize, undo, tools and the context strip.
import { S, PG, emit, on, nextUid } from './state.js';
import { frame, offset, rotOf, toWorld, place, rectFrom } from './geometry.js';
import { $, $$, el, toast, ICON, anyModalOpen } from './ui.js';
import { setHooks, layout, buildPages, rotatePage, scroller } from './viewer.js';
import { openSig } from './signature.js';
import { initSignature } from './signature.js';
import { ctxHooks, keyHooks } from './hooks.js';

export function markDirty() { S.dirty = true; $('#dirtyDot').hidden = false; }
export function snapshot() { return JSON.stringify({ o: S.objects, p: S.pages.map(p => [p.uid, p.rot]), b: S.bates }); }
export function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 150) S.undo.shift(); $('#undoBtn').disabled = false; }
export function undo() {
  if (!S.undo.length) return;
  if (document.activeElement?.blur) document.activeElement.blur();
  const st = JSON.parse(S.undo.pop()); const before = S.pages.map(p => p.uid).join(',');
  S.objects = st.o; S.bates = st.b || null;
  S.pages = st.p.map(([u, r]) => { const p = PG(u); p.rot = r; return p; });
  const keep = new Set(S.pages.map(p => p.uid)); S.osel = new Set([...S.osel].filter(u => keep.has(u)));
  S.sel = null; S.editing = null; $('#undoBtn').disabled = !S.undo.length; markDirty();
  if (S.org) emit('org:render');
  else if (before !== S.pages.map(p => p.uid).join(',')) { buildPages(); emit('pages:changed'); }
  else layout();
  emit('ctx');
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
    const t = el('div', { class: 'txt', text: o.text, style: { fontSize: o.size * S.scale + 'px', color: o.color, padding: 2 * S.scale + 'px' } });
    d.append(t); d.addEventListener('dblclick', () => startEdit(o));
  } else if (o.type === 'image') d.append(el('img', { src: o.src, alt: 'Signature', draggable: 'false' }));
  else if (o.type === 'check') d.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="12,55 40,82 90,18" fill="none" stroke="${o.color}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  else if (o.type === 'field') d.append(el('span', { class: 'fl', text: fieldLabel(o) }));
  place(d, p, o);
  if (S.sel === o.id && o.type !== 'text') { const h = el('div', { class: 'hdl', title: 'Drag to resize' }); h.addEventListener('pointerdown', e => resizeDown(p, o, d, e)); d.append(h); }
  d.addEventListener('pointerdown', e => objDown(p, o, e));
  return d;
}
export function select(id) { S.sel = id; renderAllObjs(); emit('ctx'); }
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
  S.editing = o.id;
  try { t.contentEditable = 'plaintext-only'; } catch { t.contentEditable = 'true'; }
  if (t.contentEditable !== 'plaintext-only') t.contentEditable = 'true';
  let pushed = false;
  t.addEventListener('input', () => { if (!pushed) { pushUndo(); pushed = true; } o.text = t.innerText.replace(/\n$/, ''); markDirty(); });
  t.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); t.blur(); } });
  t.addEventListener('paste', ev => { ev.preventDefault(); document.execCommand('insertText', false, (ev.clipboardData || window.clipboardData).getData('text/plain')); });
  t.addEventListener('blur', () => {
    t.contentEditable = 'false'; S.editing = null; o.text = t.innerText.replace(/\n$/, '');
    if (!o.text.trim()) { S.objects = S.objects.filter(x => x !== o); if (S.sel === o.id) S.sel = null; renderObjs(p); }
    emit('ctx');
  }, { once: true });
  t.focus();
  const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  emit('ctx');
}
export function addObj(p, o) { o.id = nextUid(); o.page = p.uid; S.objects.push(o); S.sel = o.id; renderObjs(p); markDirty(); emit('ctx'); emit('obj:added', o); return o; }
export function removeSel() {
  if (S.sel == null) return; pushUndo();
  const o = S.objects.find(x => x.id === S.sel); S.objects = S.objects.filter(x => x.id !== S.sel); S.sel = null;
  if (o) { renderObjs(PG(o.page)); emit('obj:removed', o); } markDirty(); emit('ctx');
}
export const fieldHooks = { make: null }; // the envelope composer fills this when the field tool is active

function sheetDown(p, e) {
  if (e.button > 0 || S.mode === 'sign') return;
  const P = toWorld(p, e), R = rotOf(p), tool = S.tool;
  if (tool === 'select') { if (S.sel != null) select(null); return; }
  e.preventDefault();
  if (tool === 'text') {
    pushUndo(); const tl = offset(P, R, -2, -(S.tsize * 0.75 + 2));
    const o = addObj(p, { type: 'text', x: tl[0], y: tl[1], a: R, text: '', size: S.tsize, color: S.tcolor });
    setTool('select'); setTimeout(() => startEdit(o), 0);
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
  S.tool = t; document.body.dataset.tool = t;
  $$('#tools [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  if (t !== 'select' && S.sel != null) { S.sel = null; renderAllObjs(); }
  emit('ctx');
}
const COLORS = [['#111111', 'Black'], ['#1a3a8f', 'Blue'], ['#b3261e', 'Red']];
function renderCtx(c) {
  const o = S.sel != null && S.objects.find(x => x.id === S.sel);
  if (!o) {
    if (S.tool === 'sign' && S.sig) { c.append(el('span', { text: 'Click on the page to place your signature.' }), el('button', { class: 'mini', type: 'button', text: 'Change signature', onclick: () => openSig().then(s => { if (s) S.sig = s; }) })); return true; }
    if (S.tool === 'highlight' || S.tool === 'whiteout' || S.tool === 'redact') { c.append(el('span', { text: `Drag a box on the page, or select text and press ${S.tool === 'highlight' ? 'H' : S.tool === 'whiteout' ? 'W' : 'R'} again to mark the selection.` })); return true; }
    return false;
  }
  c.append(el('span', { class: 'lbl', text: { text: 'Text', check: 'Check mark', image: 'Signature', highlight: 'Highlight', whiteout: 'White-out', redact: 'Redaction', field: 'Signature field' }[o.type] }));
  if (o.type === 'redact') c.append(el('span', { text: 'Content under this box is permanently removed when you save.', style: { color: 'var(--redline)' } }));
  if (o.type === 'text') {
    const sz = el('select', { class: 'ctl', 'aria-label': 'Text size' });
    [8, 9, 10, 11, 12, 14, 16, 18, 24, 32].forEach(n => sz.append(el('option', { value: n, text: n + ' pt' })));
    sz.value = o.size; sz.addEventListener('change', () => { pushUndo(); o.size = +sz.value; S.tsize = o.size; renderObjs(PG(o.page)); markDirty(); }); c.append(sz);
  }
  if (o.type === 'text' || o.type === 'check') {
    COLORS.forEach(([hex, name]) => { const b = el('button', { class: 'sw', type: 'button', title: name, 'aria-label': name, 'aria-pressed': String(o.color === hex), style: { background: hex } }); b.addEventListener('pointerdown', e => e.preventDefault()); b.addEventListener('click', () => { pushUndo(); o.color = hex; S.tcolor = hex; renderObjs(PG(o.page)); markDirty(); emit('ctx'); }); c.append(b); });
    if (o.type === 'text' && S.editing !== o.id) c.append(el('button', { class: 'mini', type: 'button', text: 'Edit text', onclick: () => startEdit(o) }));
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
  $('#undoBtn').addEventListener('click', undo);
  on('doc:open', () => { setTool('select'); $('#undoBtn').disabled = true; $('#flatten').disabled = false; });
  on('doc:close', () => { setTool('select'); $('#flatten').disabled = true; $('#flatten').checked = false; });
  keyHooks.push((e, { typing, mod }) => {
    if (anyModalOpen() || S.mode === 'sign') return false;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); return true; }
    if (typing || S.org) return false;
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel != null) { e.preventDefault(); removeSel(); return true; }
    if (e.key === 'Escape') { if (S.sel != null) select(null); else setTool('select'); return true; }
    if (mod || e.altKey) return false;
    const k = { v: 'select', t: 'text', k: 'check', s: 'sign', h: 'highlight', w: 'whiteout', r: 'redact' }[e.key.toLowerCase()];
    if (k && S.doc) { if ((k === 'highlight' || k === 'whiteout' || k === 'redact') && markSelection(k)) return true; setTool(k); return true; }
    return false;
  });
}

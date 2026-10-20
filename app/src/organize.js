// Organize view: thumbnails you can reorder by dragging, rotate, delete, and insert from another PDF.
import { S, PG, emit, on } from './state.js';
import { rotOf } from './geometry.js';
import { $, $$, el, toast, ICON, plural } from './ui.js';
import { buildPages, goTo } from './viewer.js';
import { drawThumb } from './sidebar.js';
import { pushUndo, markDirty } from './editor.js';
import { newPage, loadSource } from './document.js';
import { ctxHooks, keyHooks } from './hooks.js';
import { buildPdf } from './save.js';
import { PDFDocument } from 'pdf-lib';

const TW = 150, TH = 194, DIS = '#tools .tb,#zoomIn,#zoomOut,#zoomFit,#pgIn,#pgPrev,#pgNext,#batesBtn,#ocrBtn,#findBtn,#sendBtn,#printBtn';
let orgIO = null;
function orgCanvas(p) { if (!p.oc) { p.oc = document.createElement('canvas'); p.okey = null; } return p.oc; }
function ensureOrgThumb(p) {
  const key = rotOf(p); if (p.okey === key) return; p.okey = key;
  if (p.otask) { try { p.otask.cancel(); } catch {} }
  const t = drawThumb(p.proxy, orgCanvas(p), key, TW, TH); p.otask = t;
  t.promise.then(() => { if (p.otask === t) p.otask = null; }, () => { if (p.otask === t) { p.otask = null; p.okey = null; } });
}
export function openOrg() {
  if (!S.doc || S.org) return;
  if (document.activeElement?.blur) document.activeElement.blur();
  S.sel = null; S.org = true; S.osel = new Set(); S.anchor = null;
  const sc = $('#scroller'); let cur = 0; const line = sc.scrollTop + 200; for (let i = 0; i < S.pages.length; i++) { const s = S.pages[i].sec; if (s && s.offsetTop + s.offsetHeight > line) { cur = i; break; } }
  S.orgReturn = S.pages[cur]?.uid;
  sc.hidden = true; $('#org').hidden = false; $('#orgBtn').setAttribute('aria-pressed', 'true'); $('#findbar').hidden = true;
  $$(DIS).forEach(b => b.disabled = true);
  renderOrg(); emit('ctx'); $('#org').scrollTop = 0;
}
function leaveOrgUI() { S.org = false; if (orgIO) { orgIO.disconnect(); orgIO = null; } $('#org').hidden = true; $('#scroller').hidden = false; $('#orgBtn').setAttribute('aria-pressed', 'false'); $('#orgGrid').innerHTML = ''; }
export function closeOrg(goto) {
  if (!S.org) return;
  if (goto == null && S.orgReturn != null && S.pages.some(p => p.uid === S.orgReturn)) goto = S.orgReturn;
  leaveOrgUI(); $$(DIS).forEach(b => b.disabled = false);
  buildPages(); emit('pages:changed'); emit('ctx');
  if (goto != null) { const i = S.pages.findIndex(p => p.uid === goto); if (i >= 0) goTo(i + 1); }
}
export function renderOrg() {
  const g = $('#orgGrid'), keepTop = $('#org').scrollTop; g.innerHTML = '';
  if (orgIO) orgIO.disconnect();
  orgIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const p = PG(+e.target.dataset.uid); if (p) ensureOrgThumb(p); } }), { root: $('#org'), rootMargin: '500px 0px' });
  g.append(el('div', { class: 'drop-ind', hidden: true }));
  S.pages.forEach((p, idx) => {
    const n = idx + 1, c = el('div', { class: 'oth', dataset: { uid: p.uid }, tabindex: 0, role: 'option', 'aria-selected': String(S.osel.has(p.uid)) });
    c.innerHTML = `<div class="th-box"></div><div class="th-cap"><span class="n">${n}</span><span class="src"></span></div>
      <div class="th-act"><button class="ib" type="button" data-a="rl" title="Rotate left" aria-label="Rotate page ${n} left">${ICON.rl}</button><button class="ib" type="button" data-a="rr" title="Rotate right" aria-label="Rotate page ${n} right">${ICON.rr}</button><button class="ib danger" type="button" data-a="del" title="Delete page" aria-label="Delete page ${n}">${ICON.del}</button></div>`;
    c.querySelector('.th-box').append(orgCanvas(p));
    const s = c.querySelector('.src');
    if (p.src) s.textContent = `${S.sources.get(p.src).name} p.${p.si + 1}`; else if (p.si !== idx) s.textContent = `was p.${p.si + 1}`;
    s.title = s.textContent; c.setAttribute('aria-label', `Page ${n}${s.textContent ? ', ' + s.textContent : ''}`);
    const act = c.querySelector('.th-act');
    act.addEventListener('pointerdown', e => e.stopPropagation()); act.addEventListener('dblclick', e => e.stopPropagation());
    act.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'del') deletePages([p.uid]); else rotatePages([p.uid], b.dataset.a === 'rr' ? 90 : 270); });
    c.addEventListener('pointerdown', e => thDown(p, e));
    c.addEventListener('dblclick', () => closeOrg(p.uid));
    c.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); closeOrg(p.uid); }
      else if (e.key === ' ') { e.preventDefault(); if (S.osel.has(p.uid)) S.osel.delete(p.uid); else S.osel.add(p.uid); S.anchor = p.uid; updateSelUI(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const t = g.querySelectorAll('.oth')[idx + (e.key === 'ArrowRight' ? 1 : -1)]; if (t) t.focus(); }
    });
    g.append(c); orgIO.observe(c);
  });
  const add = el('button', { class: 'th-add', type: 'button', html: `${ICON.plus}<span>Insert pages from another PDF</span>` });
  add.addEventListener('click', () => pickInsert(S.pages.length)); g.append(add);
  $('#org').scrollTop = keepTop;
}
function updateSelUI() { $$('#orgGrid .oth').forEach(c => c.setAttribute('aria-selected', String(S.osel.has(+c.dataset.uid)))); emit('ctx'); }
function clickSel(p, e) {
  const multi = e.ctrlKey || e.metaKey;
  if (e.shiftKey && S.anchor != null) {
    const a = S.pages.findIndex(x => x.uid === S.anchor), b = S.pages.indexOf(p);
    if (a >= 0) { const lo = Math.min(a, b), hi = Math.max(a, b); if (!multi) S.osel = new Set(); for (let i = lo; i <= hi; i++) S.osel.add(S.pages[i].uid); updateSelUI(); return; }
  }
  if (multi) { if (S.osel.has(p.uid)) S.osel.delete(p.uid); else S.osel.add(p.uid); } else S.osel = new Set([p.uid]);
  S.anchor = p.uid; updateSelUI();
}
function thDown(p, e) {
  if (e.button > 0) return; const sx = e.clientX, sy = e.clientY; let d = null;
  const mv = ev => { if (!d) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return; d = beginDrag(p, ev); } ev.preventDefault(); dragMove(d, ev); };
  const up = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); if (d) endDrag(d, ev.type === 'pointerup'); else if (ev.type === 'pointerup') clickSel(p, ev); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
function beginDrag(p, ev) {
  if (!S.osel.has(p.uid)) { S.osel = new Set([p.uid]); S.anchor = p.uid; updateSelUI(); }
  const moving = S.pages.filter(x => S.osel.has(x.uid));
  const ghost = el('div', { class: 'drag-ghost' }); const src = orgCanvas(p), mini = document.createElement('canvas');
  mini.width = src.width || 1; mini.height = src.height || 1; try { mini.getContext('2d').drawImage(src, 0, 0); } catch {}
  mini.style.width = Math.round((parseFloat(src.style.width) || 110) * .62) + 'px'; mini.style.display = 'block'; ghost.append(mini);
  if (moving.length > 1) ghost.append(el('span', { class: 'cnt', text: moving.length }));
  document.body.append(ghost); document.body.classList.add('dragging');
  $$('#orgGrid .oth').forEach(c => { if (S.osel.has(+c.dataset.uid)) c.classList.add('moving'); });
  const d = { moving, ghost, ind: $('#orgGrid .drop-ind'), index: null, x: ev.clientX, y: ev.clientY, raf: 0 };
  const tick = () => { const o = $('#org'), r = o.getBoundingClientRect(); let dy = 0; if (d.y < r.top + 70) dy = -Math.min(24, (r.top + 70 - d.y) / 3); else if (d.y > r.bottom - 70) dy = Math.min(24, (d.y - (r.bottom - 70)) / 3); if (dy) { o.scrollTop += dy; computeDrop(d); } d.raf = requestAnimationFrame(tick); };
  d.raf = requestAnimationFrame(tick); return d;
}
function dragMove(d, ev) { d.x = ev.clientX; d.y = ev.clientY; d.ghost.style.left = d.x + 14 + 'px'; d.ghost.style.top = d.y + 10 + 'px'; computeDrop(d); }
function computeDrop(d) {
  const cards = $$('#orgGrid .oth'); let best = null, bd = Infinity, bi = 0;
  cards.forEach((c, i) => { const r = c.getBoundingClientRect(); const ry = d.y < r.top ? r.top - d.y : d.y > r.bottom ? d.y - r.bottom : 0; const sc = ry * 1000 + Math.abs(d.x - (r.left + r.width / 2)); if (sc < bd) { bd = sc; best = c; bi = i; } });
  if (!best) { d.index = null; d.ind.hidden = true; return; }
  const r = best.getBoundingClientRect(), before = d.x < r.left + r.width / 2; d.index = before ? bi : bi + 1;
  const gap = 20; d.ind.hidden = false;
  d.ind.style.left = ((before ? best.offsetLeft : best.offsetLeft + best.offsetWidth) + (before ? -gap / 2 : gap / 2) - 2) + 'px';
  d.ind.style.top = best.offsetTop + 'px'; d.ind.style.height = best.offsetHeight + 'px';
}
function endDrag(d, commit) {
  cancelAnimationFrame(d.raf); d.ghost.remove(); d.ind.hidden = true; document.body.classList.remove('dragging');
  $$('#orgGrid .oth.moving').forEach(c => c.classList.remove('moving'));
  if (!commit || d.index == null) return;
  const set = new Set(d.moving.map(p => p.uid)); arrange(set, S.pages.slice(0, d.index).filter(p => !set.has(p.uid)).length);
}
function arrange(set, at) {
  const moving = S.pages.filter(p => set.has(p.uid)), rest = S.pages.filter(p => !set.has(p.uid));
  rest.splice(Math.max(0, Math.min(rest.length, at)), 0, ...moving);
  if (rest.every((p, i) => p === S.pages[i])) return false;
  pushUndo(); S.pages = rest; markDirty(); renderOrg(); emit('ctx'); return true;
}
function moveSelTo(pos) {
  if (!S.osel.size) return; const n = S.pages.length;
  if (!(pos >= 1 && pos <= n)) { toast(`Enter a position from 1 to ${n}.`); return; }
  if (arrange(new Set(S.osel), pos - 1)) toast(`Moved ${plural(S.osel.size, 'page')} to position ${pos}.`);
}
export function deletePages(uids) {
  const set = new Set(uids), k = S.pages.filter(p => set.has(p.uid)).length; if (!k) return;
  if (S.pages.length - k < 1) { toast('A PDF needs at least one page. Insert another page before deleting this one.'); return; }
  pushUndo(); S.pages = S.pages.filter(p => !set.has(p.uid)); uids.forEach(u => S.osel.delete(u));
  markDirty(); renderOrg(); emit('ctx'); toast(`Deleted ${plural(k, 'page')}. Use Undo to bring ${k > 1 ? 'them' : 'it'} back.`);
}
export function rotatePages(uids, deg) { const set = new Set(uids); if (!set.size) return; pushUndo(); S.pages.forEach(p => { if (set.has(p.uid)) p.rot = (p.rot + deg) % 360; }); markDirty(); renderOrg(); }
// Save the selected pages (with everything placed on them) as a new PDF.
async function extractPages(uids) {
  const idx = S.pages.map((p, i) => uids.has(p.uid) ? i : -1).filter(i => i >= 0); if (!idx.length) return;
  try {
    const { bytes } = await buildPdf({ editLayer: false });
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }), out = await PDFDocument.create();
    try { const f = src.getForm(); if (f.getFields().length) f.flatten(); } catch {}
    const pages = await out.copyPages(src, idx); pages.forEach(pg => out.addPage(pg));
    const data = await out.save({ useObjectStreams: false });
    const name = (S.name.replace(/\.pdf$/i, '') || 'document') + '-pages-' + toRanges(idx).replace(/,\s*/g, '_') + '.pdf';
    if (typeof window.pdfviewSaveHook === 'function') await window.pdfviewSaveHook({ filename: name, bytes: data });
    else { const a = el('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/pdf' })), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    toast(`Saved ${plural(idx.length, 'page')} as ${name}.`);
  } catch (e) { console.error(e); toast('Those pages could not be extracted.'); }
}
function defaultPos() { if (!S.osel.size) return S.pages.length; let last = -1; S.pages.forEach((p, i) => { if (S.osel.has(p.uid)) last = i; }); return last + 1; }
function mk(label, fn, o = {}) {
  const b = el('button', { type: 'button', class: 'mini' + (o.cls ? ' ' + o.cls : ''), title: o.title, 'aria-label': o.aria, disabled: !!o.disabled });
  if (o.icon) { b.innerHTML = o.icon; if (label) b.append(el('span', { text: label })); } else b.textContent = label;
  b.addEventListener('click', fn); return b;
}
function renderOrgCtx(c) {
  const n = S.pages.length, k = S.osel.size, sel = [...S.osel];
  c.append(el('span', { class: 'lbl', text: 'Organize pages' }), el('span', { text: plural(n, 'page') + (k ? ` · ${k} selected` : '') }));
  c.append(mk('Insert pages…', () => pickInsert(defaultPos()), { cls: 'primary', icon: ICON.ins, title: k ? 'Insert pages after the selected pages' : 'Insert pages at the end' }));
  const sep = () => c.append(el('span', { class: 'sep' })); sep();
  c.append(mk('', () => rotatePages(sel, 270), { icon: ICON.rl, aria: 'Rotate selected pages left', title: 'Rotate selected left', disabled: !k }));
  c.append(mk('', () => rotatePages(sel, 90), { icon: ICON.rr, aria: 'Rotate selected pages right', title: 'Rotate selected right', disabled: !k }));
  c.append(mk(k > 1 ? `Delete ${k} pages` : 'Delete', () => deletePages(sel), { cls: 'danger', disabled: !k }));
  c.append(mk(k > 1 ? `Extract ${k} pages…` : 'Extract page…', () => extractPages(new Set(sel)), { disabled: !k, title: 'Save the selected pages as a new PDF', cls: 'extract' })); sep();
  const inp = el('input', { type: 'number', class: 'ctl', id: 'orgMoveTo', min: 1, max: n, disabled: !k, style: { width: '64px' } });
  if (k) { let first = -1; S.pages.forEach((p, i) => { if (first < 0 && S.osel.has(p.uid)) first = i; }); inp.value = first + 1; }
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); moveSelTo(+inp.value); } });
  c.append(el('label', { for: 'orgMoveTo', text: 'Move to position' }), inp, mk('Move', () => moveSelTo(+inp.value), { disabled: !k })); sep();
  c.append(k === n ? mk('Clear selection', () => { S.osel = new Set(); updateSelUI(); }) : mk('Select all', () => { S.osel = new Set(S.pages.map(p => p.uid)); updateSelUI(); }));
  c.append(el('span', { class: 'grow' }), mk('Done', () => closeOrg(), { cls: 'primary', title: 'Back to the page view' }));
  return true;
}

/* ---------- insert pages from another PDF ---------- */
let insPos = 0, INS = null, insIO = null;
function pickInsert(pos) { insPos = pos; $('#insFile').click(); }
async function loadInsert(file, pos) { const src = await loadSource(file); if (src) openIns(src, pos); }
function toRanges(list) { const out = []; let i = 0; while (i < list.length) { let j = i; while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++; out.push(i === j ? `${list[i] + 1}` : `${list[i] + 1}-${list[j] + 1}`); i = j + 1; } return out.join(', '); }
function parseRanges(str, n) {
  const s = new Set(), t = str.trim(); if (!t) return s;
  for (const part of t.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)?\s*-\s*(\d+)?$/);
    if (m && (m[1] || m[2])) { const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : n; if (a < 1 || b > n || a > b) return null; for (let i = a; i <= b; i++) s.add(i - 1); }
    else if (/^\d+$/.test(part)) { const a = +part; if (a < 1 || a > n) return null; s.add(a - 1); } else return null;
  }
  return s;
}
function openIns(src, pos) {
  const n = src.doc.numPages; INS = { src, n, picked: new Set(Array.from({ length: n }, (_, i) => i)) };
  $('#insName').textContent = `${src.name} · ${plural(n, 'page')}`;
  const sel = $('#insPos'); sel.innerHTML = ''; const N = S.pages.length, opt = (v, t) => sel.append(el('option', { value: v, text: t }));
  opt(0, 'At the beginning'); for (let k = 1; k < N; k++) opt(k, `After page ${k}`); opt(N, `At the end (after page ${N})`);
  sel.value = String(Math.max(0, Math.min(N, pos)));
  const g = $('#insGrid'); g.innerHTML = ''; if (insIO) insIO.disconnect();
  insIO = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting || e.target._done) return; e.target._done = true; insIO.unobserve(e.target); const i = +e.target.dataset.i, cv = e.target.querySelector('canvas'); src.doc.getPage(i + 1).then(pp => drawThumb(pp, cv, pp.rotate || 0, 110, 142).promise).catch(() => {}); }), { root: g, rootMargin: '300px 0px' });
  for (let i = 0; i < n; i++) {
    const b = el('button', { type: 'button', class: 'ip', dataset: { i }, html: `<span class="bx"><canvas width="1" height="1"></canvas></span><span>Page ${i + 1}</span>` });
    b.addEventListener('click', () => { if (INS.picked.has(i)) INS.picked.delete(i); else INS.picked.add(i); syncIns(true); }); g.append(b); insIO.observe(b);
  }
  $('#insRange').classList.remove('bad'); syncIns(true); $('#insModal').hidden = false; $('#insGo').focus();
}
function syncIns(updateText) {
  if (!INS) return; $$('#insGrid .ip').forEach(b => b.setAttribute('aria-pressed', String(INS.picked.has(+b.dataset.i))));
  const k = INS.picked.size; $('#insCount').textContent = `${k} of ${INS.n} selected`; $('#insGo').textContent = k ? `Insert ${plural(k, 'page')}` : 'Insert pages'; $('#insGo').disabled = !k;
  if (updateText) { $('#insRange').value = toRanges([...INS.picked].sort((a, b) => a - b)); $('#insRange').classList.remove('bad'); }
}
function closeIns(used) { if (insIO) { insIO.disconnect(); insIO = null; } $('#insModal').hidden = true; $('#insGrid').innerHTML = ''; if (!used && INS && !S.sources.has(INS.src.id)) { try { INS.src.doc.destroy(); } catch {} } INS = null; }
async function doInsert() {
  if (!INS || !INS.picked.size) return;
  const { src } = INS, list = [...INS.picked].sort((a, b) => a - b), pos = +$('#insPos').value; $('#insGo').disabled = true;
  try {
    const recs = []; for (const si of list) { const proxy = await src.doc.getPage(si + 1); recs.push(newPage(src.id, si, proxy)); }
    S.sources.set(src.id, src); pushUndo(); S.pages.splice(pos, 0, ...recs); markDirty();
    S.osel = new Set(recs.map(r => r.uid)); S.anchor = recs[0].uid; closeIns(true);
    if (!S.org) openOrg(); renderOrg(); emit('ctx');
    const first = $(`#orgGrid .oth[data-uid="${recs[0].uid}"]`); if (first) first.scrollIntoView({ block: 'nearest' });
    toast(`Inserted ${plural(recs.length, 'page')} from ${src.name}.`);
  } catch (e) { console.error(e); toast('Those pages could not be inserted.'); $('#insGo').disabled = false; }
}

// Append every page of the given files after the current last page (used when several files are opened together).
export async function appendFiles(files) {
  let added = 0, names = [];
  for (const f of files) {
    const src = await loadSource(f); if (!src) continue;
    const recs = []; for (let i = 0; i < src.doc.numPages; i++) recs.push(newPage(src.id, i, await src.doc.getPage(i + 1)));
    S.sources.set(src.id, src); S.pages.push(...recs); added += recs.length; names.push(src.name);
  }
  if (!added) return;
  markDirty(); if (S.org) renderOrg(); else buildPages(); emit('pages:changed'); emit('ctx');
  toast(`Combined: added ${plural(added, 'page')} from ${names.join(', ')}. Save to keep the combined file.`);
}
export function init() {
  on('files:append', appendFiles);
  $('#orgBtn').addEventListener('click', () => S.org ? closeOrg() : openOrg());
  $('#org').addEventListener('pointerdown', e => { const bare = e.target.id === 'org' || e.target.id === 'orgGrid' || e.target.classList.contains('org-hint'); if (bare && S.osel.size && !(e.ctrlKey || e.metaKey || e.shiftKey)) { S.osel = new Set(); updateSelUI(); } });
  $('#insFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; loadInsert(f, insPos); });
  $('#insRange').addEventListener('input', () => { if (!INS) return; const s = parseRanges($('#insRange').value, INS.n); if (s) { INS.picked = s; $('#insRange').classList.remove('bad'); syncIns(false); } else $('#insRange').classList.add('bad'); });
  $('#insAll').addEventListener('click', () => { INS.picked = new Set(Array.from({ length: INS.n }, (_, i) => i)); syncIns(true); });
  $('#insNone').addEventListener('click', () => { INS.picked = new Set(); syncIns(true); });
  $('#insCancel').addEventListener('click', () => closeIns(false)); $('#insGo').addEventListener('click', doInsert);
  $('#insModal').addEventListener('pointerdown', e => { if (e.target.id === 'insModal') closeIns(false); });
  const prev = ctxHooks.render; ctxHooks.render = c => S.org ? renderOrgCtx(c) : (prev ? prev(c) : false);
  on('org:render', renderOrg);
  on('drop', f => { if (S.org && S.doc && $('#insModal').hidden) loadInsert(f, defaultPos()); });
  on('doc:open', () => { if (S.org) leaveOrgUI(); });
  keyHooks.push((e, { typing, mod }) => {
    if (!$('#insModal').hidden) { if (e.key === 'Escape') closeIns(false); return true; }
    if (!S.org || typing) return false;
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); S.osel = new Set(S.pages.map(p => p.uid)); updateSelUI(); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.osel.size) { e.preventDefault(); deletePages([...S.osel]); return true; }
    if (e.key === 'Escape') { if (S.osel.size) { S.osel = new Set(); updateSelUI(); } else closeOrg(); return true; }
    return false;
  });
}

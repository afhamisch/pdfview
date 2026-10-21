// Sidebar: page thumbnails and the document outline.
import { S, PG, on, emit } from './state.js';
import { rotOf } from './geometry.js';
import { $, el, ICON } from './ui.js';
import { goTo, linkService, currentPage, scrollToPagePoint } from './viewer.js';

const TW = 132, TH = 170;
let thIO = null, tab = 'pages';
export function drawThumb(proxy, canvas, rotation, boxW, boxH) {
  const v1 = proxy.getViewport({ scale: 1, rotation });
  const sc = Math.min(boxW / v1.width, boxH / v1.height), vp = proxy.getViewport({ scale: sc, rotation });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(vp.width * dpr)); canvas.height = Math.max(1, Math.floor(vp.height * dpr));
  canvas.style.width = Math.floor(vp.width) + 'px'; canvas.style.height = Math.floor(vp.height) + 'px';
  return proxy.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
}
export function thumbCanvas(p) { if (!p.tc) { p.tc = document.createElement('canvas'); p.tkey = null; } return p.tc; }
export function ensureThumb(p, w = TW, h = TH) {
  const key = rotOf(p) + '|' + w; if (p.tkey === key) return; p.tkey = key;
  if (p.ttask) { try { p.ttask.cancel(); } catch {} }
  const t = drawThumb(p.proxy, thumbCanvas(p), rotOf(p), w, h); p.ttask = t;
  t.promise.then(() => { if (p.ttask === t) p.ttask = null; }, () => { if (p.ttask === t) { p.ttask = null; p.tkey = null; } });
}
export function renderThumbs() {
  const host = $('#thumbs'); host.innerHTML = ''; if (thIO) thIO.disconnect();
  thIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const p = PG(+e.target.dataset.uid); if (p) ensureThumb(p); } }), { root: $('#side'), rootMargin: '400px 0px' });
  S.pages.forEach((p, i) => {
    const c = el('button', { type: 'button', class: 'th', dataset: { uid: p.uid }, 'aria-label': 'Page ' + (i + 1), onclick: () => goTo(i + 1) }, el('span', { class: 'th-box' }, thumbCanvas(p)), el('span', { class: 'th-n', text: i + 1 }));
    host.append(c); thIO.observe(c);
  });
  markCurrentThumb(currentPage());
}
export function markCurrentThumb(n) {
  const host = $('#thumbs'); host.querySelectorAll('.th.cur').forEach(c => c.classList.remove('cur'));
  const c = host.children[n - 1]; if (c) { c.classList.add('cur'); if (tab === 'pages' && !$('#side').hidden) c.scrollIntoView({ block: 'nearest' }); }
}
function outlineNode(item, depth) {
  const row = el('div', { class: 'ol-item', style: { paddingLeft: 8 + depth * 14 + 'px' } });
  const a = el('button', { type: 'button', class: 'ol-link', text: item.title || '(untitled)', onclick: () => { if (item.dest) linkService.goToDestination(item.dest); else if (item.url) window.open(item.url, '_blank', 'noopener'); } });
  row.append(a); const frag = document.createDocumentFragment(); frag.append(row);
  (item.items || []).forEach(ch => frag.append(outlineNode(ch, depth + 1)));
  return frag;
}
export function renderOutline() {
  const host = $('#outline'); host.innerHTML = '';
  const ol = S.meta.outline;
  if (!ol || !ol.length) { host.append(el('p', { class: 'muted', text: 'This PDF has no bookmarks.' })); $('#tabOutline').disabled = false; return; }
  ol.forEach(it => host.append(outlineNode(it, 0)));
}
/* Notes: ours (editable) plus the comments already in the file. */
let notesScan = null;
export async function renderNotes() {
  const host = $('#notes'); if (!host || !S.doc) return;
  if (!S.meta.comments) {
    host.innerHTML = ''; host.append(el('p', { class: 'muted', text: 'Reading comments…' }));
    if (notesScan === S.doc) return;
    notesScan = S.doc; const doc = S.doc, found = [];
    for (const p of S.pages) { if (S.doc !== doc) return; if (p.src !== 0) continue; try { for (const a of await p.proxy.getAnnotations()) { if (['Popup', 'Widget', 'Link'].includes(a.subtype) || !(a.contentsObj && a.contentsObj.str && a.contentsObj.str.trim())) continue; found.push({ page: p.uid, author: (a.titleObj && a.titleObj.str) || '', text: a.contentsObj.str, date: a.modificationDate || '', rect: a.rect, subtype: a.subtype }); } } catch {} }
    if (S.doc === doc) { S.meta.comments = found; notesScan = null; if (tab === 'notes') renderNotes(); }
    return;
  }
  const mine = S.objects.filter(o => o.type === 'note').map(o => { const p = PG(o.page); return { idx: S.pages.indexOf(p), p, author: o.author, text: o.text, x: o.x, y: o.y, mine: true, id: o.id }; }).filter(n => n.idx >= 0);
  const theirs = S.meta.comments.map(c => { const p = PG(c.page); return { idx: S.pages.indexOf(p), p, author: c.author, text: c.text, x: c.rect[0], y: c.rect[3], subtype: c.subtype }; }).filter(n => n.idx >= 0);
  const all = [...mine, ...theirs].sort((a, b) => a.idx - b.idx || b.y - a.y);
  host.innerHTML = '';
  if (!all.length) { host.append(el('p', { class: 'muted', text: 'No notes yet. Pick the Note tool and click on a page.' })); return; }
  for (const n of all) {
    const row = el('button', { class: 'note-row' + (n.mine ? ' mine' : ''), type: 'button' }, el('div', { class: 'nmeta', text: `p. ${n.idx + 1}${n.author ? ' · ' + n.author : ''}${!n.mine && n.subtype && n.subtype !== 'Text' ? ' · ' + n.subtype : ''}` }), el('div', { class: 'nbody', text: (n.text || '').trim().slice(0, 160) || '(empty)' }));
    row.addEventListener('click', () => { goTo(n.idx + 1); scrollToPagePoint(n.p, n.x, n.y); if (n.mine) emit('select:obj', n.id); });
    host.append(row);
  }
}
export function setTab(t) { tab = t; $('#tabPages').setAttribute('aria-pressed', String(t === 'pages')); $('#tabOutline').setAttribute('aria-pressed', String(t === 'outline')); $('#tabNotes').setAttribute('aria-pressed', String(t === 'notes')); $('#notes').hidden = t !== 'notes'; if (t === 'notes') renderNotes(); $('#thumbs').hidden = t !== 'pages'; $('#outline').hidden = t !== 'outline'; }
export function toggleSide(force) { const s = $('#side'); s.hidden = force == null ? !s.hidden : !force; $('#sideBtn').setAttribute('aria-pressed', String(!s.hidden)); if (!s.hidden && S.doc) { renderThumbs(); renderOutline(); } }
export function initSidebar() {
  $('#sideBtn').addEventListener('click', () => toggleSide());
  $('#tabPages').addEventListener('click', () => setTab('pages')); $('#tabOutline').addEventListener('click', () => setTab('outline')); $('#tabNotes').addEventListener('click', () => setTab('notes'));
  on('ctx', () => { if (tab === 'notes' && !$('#side').hidden && S.doc) renderNotes(); });
  on('doc:open', () => { if (!$('#side').hidden) { renderThumbs(); renderOutline(); } });
  on('tab:switch', () => { if (!$('#side').hidden) { renderThumbs(); renderOutline(); } });
  on('doc:close', () => { $('#thumbs').innerHTML = ''; $('#outline').innerHTML = ''; $('#notes').innerHTML = ''; });
  on('nav', n => markCurrentThumb(n));
  on('pages:changed', () => { if (!$('#side').hidden) renderThumbs(); });
}

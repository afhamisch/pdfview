// Find in document: text is pulled per page through the worker and cached; hits are wrapped in the
// text layer's spans so they highlight at any zoom.
import { S, PG } from './state.js';
import { $, el, ICON } from './ui.js';
import { goTo, scrollToPagePoint, requestRender } from './viewer.js';

const F = { query: '', hits: [], cur: -1, open: false, running: 0, busy: false };
export async function pageText(p) {
  if (p.text) return p.text;
  const tc = await p.proxy.getTextContent({ includeMarkedContent: false });
  const items = tc.items.filter(i => i.str !== undefined);
  let s = ''; const offs = [];
  for (const it of items) { offs.push(s.length); s += it.str; if (it.hasEOL) s += '\n'; }
  p.text = { str: s, lower: s.toLowerCase(), items, offs };
  return p.text;
}
function findIn(p, q) {
  const out = []; const { lower, items, offs } = p.text; let i = 0;
  while ((i = lower.indexOf(q, i)) >= 0) { out.push({ page: p, start: i, end: i + q.length }); i += Math.max(1, q.length); }
  return out;
}
function itemAt(p, pos) { const { offs } = p.text; let lo = 0, hi = offs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (offs[m] <= pos) lo = m; else hi = m - 1; } return lo; }
export function applyHighlights(p) {
  if (!p.textLayer || !p.text) return;
  const divs = p.textLayer.textDivs; if (!divs) return;
  const hits = F.hits.filter(h => h.page === p); if (!hits.length) return;
  const perItem = new Map();
  for (const h of hits) {
    const i0 = itemAt(p, h.start), i1 = itemAt(p, Math.max(h.start, h.end - 1));
    for (let i = i0; i <= i1; i++) {
      const base = p.text.offs[i], len = p.text.items[i].str.length;
      const a = Math.max(0, h.start - base), b = Math.min(len, h.end - base);
      if (b > a) { if (!perItem.has(i)) perItem.set(i, []); perItem.get(i).push({ a, b, cur: F.hits[F.cur] === h }); }
    }
  }
  for (const [i, ranges] of perItem) {
    const div = divs[i]; if (!div) continue; const str = p.text.items[i].str;
    const br = div.querySelector('br'); div.textContent = '';
    ranges.sort((x, y) => x.a - y.a); let pos = 0;
    for (const r of ranges) { if (r.a > pos) div.append(str.slice(pos, r.a)); div.append(el('span', { class: 'hit' + (r.cur ? ' cur' : ''), text: str.slice(r.a, r.b) })); pos = r.b; }
    if (pos < str.length) div.append(str.slice(pos));
    if (br) div.append(br);
  }
}
function clearHighlights() {
  for (const p of S.pages) { if (!p.textLayer) continue; const divs = p.textLayer.textDivs || []; divs.forEach((d, i) => { if (d.querySelector('.hit')) { const br = d.querySelector('br'); d.textContent = p.text.items[i].str; if (br) d.append(br); } }); }
}
export async function runSearch(q) {
  F.query = q; const run = ++F.running; clearHighlights(); F.hits = []; F.cur = -1; F.busy = !!q; status();
  if (!q || !S.doc) return;
  const ql = q.toLowerCase();
  for (const p of S.pages) {
    await pageText(p); if (run !== F.running) return;
    F.hits.push(...findIn(p, ql)); status();
  }
  F.busy = false;
  if (F.hits.length) { F.cur = 0; focusHit(); }
  S.pages.forEach(p => { if (p.textLayer) applyHighlights(p); });
  status();
}
function status() { const c = $('#findCount'); if (!c) return; c.textContent = !F.query ? '' : F.hits.length ? `${F.cur < 0 ? '' : (F.cur + 1) + ' of '}${F.hits.length}${F.busy ? '…' : ''}` : F.busy ? 'Searching…' : 'No matches'; }
function focusHit() {
  const h = F.hits[F.cur]; if (!h) return; const p = h.page; const n = S.pages.indexOf(p) + 1;
  const it = p.text.items[itemAt(p, h.start)];
  if (it && it.transform) scrollToPagePoint(p, it.transform[4], it.transform[5]); else goTo(n);
  S.pages.forEach(x => { if (x.textLayer) { const divs = x.textLayer.textDivs || []; if (divs.some(d => d.querySelector('.hit'))) { clearHighlightsOn(x); applyHighlights(x); } } });
  if (p.textLayer) { clearHighlightsOn(p); applyHighlights(p); }
  status();
}
function clearHighlightsOn(p) { const divs = p.textLayer.textDivs || []; divs.forEach((d, i) => { if (d.querySelector('.hit')) { const br = d.querySelector('br'); d.textContent = p.text.items[i].str; if (br) d.append(br); } }); }
export function nextHit(dir = 1) { if (!F.hits.length) return; F.cur = (F.cur + dir + F.hits.length) % F.hits.length; focusHit(); }
export function openFind() { const b = $('#findbar'); b.hidden = false; F.open = true; const i = $('#findIn'); i.focus(); i.select(); }
export function closeFind() { $('#findbar').hidden = true; F.open = false; F.query = ''; clearHighlights(); F.hits = []; F.cur = -1; status(); }
export function initSearch() {
  const bar = $('#findbar'); let t;
  $('#findIn').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => runSearch(e.target.value.trim()), 180); });
  $('#findIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (F.query !== e.target.value.trim()) runSearch(e.target.value.trim()); else nextHit(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { closeFind(); } });
  $('#findPrev').addEventListener('click', () => nextHit(-1)); $('#findNext').addEventListener('click', () => nextHit(1)); $('#findClose').addEventListener('click', closeFind);
}
export const findState = F;

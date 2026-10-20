// The page view: virtualized rendering with a bounded queue, text layer, form layer, zoom, navigation.
import { pdfjsLib as lib } from './pdfjs.js';
import { S, PG, emit, on } from './state.js';
import { rotOf } from './geometry.js';
import { $, el, ICON } from './ui.js';

let io = null, ioFar = null;
const RQ = { q: new Set(), active: 0, MAX: 2, t: 0, lastT: 0, lastY: 0, v: 0 };
const hooks = { pageBar: null, onSheetDown: null, afterLayoutPage: null, afterTextLayer: null };
export function setHooks(h) { Object.assign(hooks, h); }
export const scroller = () => $('#scroller');

// Minimal link service for pdf.js's annotation layer: internal links jump to the page, external open a tab.
export const linkService = {
  eventBus: null, isInPresentationMode: false, externalLinkEnabled: true, externalLinkTarget: 2, externalLinkRel: 'noopener noreferrer nofollow',
  getDestinationHash: () => '#', getAnchorUrl: () => '#',
  addLinkAttributes(link, url) { link.href = url; link.target = '_blank'; link.rel = this.externalLinkRel; },
  async goToDestination(dest) {
    try {
      const d = typeof dest === 'string' ? await S.doc.getDestination(dest) : dest;
      if (!d) return; const ref = d[0];
      const idx = typeof ref === 'object' ? await S.doc.getPageIndex(ref) : ref;
      const p = S.pages.find(x => x.src === 0 && x.si === idx); if (p) goTo(S.pages.indexOf(p) + 1);
    } catch (e) { console.warn('link', e); }
  },
  executeNamedAction(name) { if (name === 'NextPage') goTo(currentPage() + 1); else if (name === 'PrevPage') goTo(currentPage() - 1); else if (name === 'FirstPage') goTo(1); else if (name === 'LastPage') goTo(S.pages.length); },
  executeSetOCGState() {}, getAttachmentContent: async () => null
};

export function buildPages() {
  const host = $('#pages'); host.innerHTML = '';
  if (io) io.disconnect(); if (ioFar) ioFar.disconnect();
  io = new IntersectionObserver(es => es.forEach(e => {
    const p = PG(+e.target.dataset.uid); if (!p) return; p.visible = e.isIntersecting;
    if (p.visible) requestRender(p); else if (p.task) { try { p.task.cancel(); } catch {} }
  }), { root: scroller(), rootMargin: '900px 0px' });
  ioFar = new IntersectionObserver(es => es.forEach(e => { const p = PG(+e.target.dataset.uid); if (p && !e.isIntersecting) releaseCanvas(p); }), { root: scroller(), rootMargin: '3000px 0px' });
  const N = S.pages.length;
  S.pages.forEach((p, idx) => {
    const n = idx + 1;
    const sec = el('section', { class: 'pg', dataset: { uid: p.uid } });
    const bar = el('div', { class: 'pg-bar' }, el('span', { class: 'pg-lbl', html: `Page ${n} <span class="of">of ${N}</span>` }));
    if (p.src) bar.firstChild.append(el('span', { class: 'of src-note', text: ` from ${S.sources.get(p.src).name}, p.${p.si + 1}` }));
    if (hooks.pageBar) bar.append(hooks.pageBar(p, n));
    const sheet = el('div', { class: 'sheet' }, el('canvas'), el('div', { class: 'textLayer' }), el('div', { class: 'annotationLayer' }), el('div', { class: 'layer ol' }));
    sec.append(bar, sheet);
    Object.assign(p, { sec, sheet, canvas: sheet.querySelector('canvas'), tl: sheet.querySelector('.textLayer'), al: sheet.querySelector('.annotationLayer'), ol: sheet.querySelector('.ol'), key: '', tlKey: '', visible: false, textLayer: null, annLayer: null });
    if (hooks.onSheetDown) sheet.addEventListener('pointerdown', e => hooks.onSheetDown(p, e));
    host.append(sec); io.observe(sec); ioFar.observe(sec);
  });
  layout(); updateNav();
}

export function fitScale(mode) {
  const sc = scroller(); const availW = Math.max(200, sc.clientWidth - 56), availH = Math.max(200, sc.clientHeight - 70);
  let mw = 1, mh = 1; S.pages.forEach(p => { const v = p.proxy.getViewport({ scale: 1, rotation: rotOf(p) }); mw = Math.max(mw, v.width); mh = Math.max(mh, v.height); });
  const s = mode === 'page' ? Math.min(availW / mw, availH / mh) : Math.min(availW, 1100) / mw;
  return Math.max(.2, Math.min(6, s));
}
export function layout() {
  if (!S.pages.length || S.org) return;
  if (S.fit) S.scale = fitScale(S.fit);
  $('#zoomPct').textContent = Math.round(S.scale * 72 / 96 * 100) + '%';
  S.pages.forEach(layoutPage);
}
export function layoutPage(p) {
  if (!p.sheet) return;
  p.vp = p.proxy.getViewport({ scale: S.scale, rotation: rotOf(p) });
  p.sheet.style.width = p.vp.width + 'px'; p.sheet.style.height = p.vp.height + 'px';
  p.sheet.style.setProperty('--scale-factor', String(S.scale));
  if (p.annLayer) { try { p.annLayer.update({ viewport: p.vp.clone({ dontFlip: true }) }); } catch (e) { console.warn(e); } }
  if (hooks.afterLayoutPage) hooks.afterLayoutPage(p);
  if (p.visible) requestRender(p);
}

/* Render queue: at most two pages render at once, nearest the viewport first; pages that scrolled away
   before their turn are dropped, and nothing is dispatched while the view is moving fast, because the
   worker cannot abort a page it has started decoding. */
export function requestRender(p) { RQ.q.add(p); pumpRender(); }
export function noteScroll() { const t = performance.now(), y = scroller().scrollTop; if (RQ.lastT) { const dt = t - RQ.lastT; if (dt > 0) RQ.v = Math.abs(y - RQ.lastY) / dt * 1000; } RQ.lastT = t; RQ.lastY = y; }
function pumpRender() {
  if (RQ.q.size && RQ.v > 2500 && performance.now() - RQ.lastT < 150) { clearTimeout(RQ.t); RQ.t = setTimeout(pumpRender, 160); return; }
  while (RQ.active < RQ.MAX && RQ.q.size) {
    const top = scroller().scrollTop; let best = null, bd = Infinity;
    for (const p of RQ.q) { if (!p.visible || !p.sec) { RQ.q.delete(p); continue; } const d = Math.abs(p.sec.offsetTop - top); if (d < bd) { bd = d; best = p; } }
    if (!best) return;
    RQ.q.delete(best); RQ.active++;
    renderPage(best).finally(() => { RQ.active--; pumpRender(); });
  }
}
async function renderPage(p) {
  await renderCanvas(p);
  await renderTextLayer(p);
  await renderAnnotations(p);
}
async function renderCanvas(p) {
  const key = S.scale + '|' + p.rot; if (p.key === key) return;
  if (p.task) { try { p.task.cancel(); } catch {} }
  const dpr = Math.min(window.devicePixelRatio || 1, 2), c = p.canvas;
  c.style.width = p.vp.width + 'px'; c.style.height = p.vp.height + 'px';
  const off = document.createElement('canvas');
  off.width = Math.floor(p.vp.width * dpr); off.height = Math.floor(p.vp.height * dpr);
  const task = p.proxy.render({ canvasContext: off.getContext('2d'), viewport: p.vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null, annotationMode: lib.AnnotationMode.ENABLE_FORMS });
  p.task = task; p.key = key;
  try { await task.promise; if (p.task === task) { c.width = off.width; c.height = off.height; c.getContext('2d').drawImage(off, 0, 0); } }
  catch (e) { if (p.task === task) p.key = ''; }
  finally { if (p.task === task) p.task = null; off.width = off.height = 0; }
}
async function renderTextLayer(p) {
  const key = S.scale + '|' + p.rot; if (p.tlKey === key || !p.visible) return;
  p.tl.innerHTML = ''; p.tlKey = key;
  try {
    const tlr = new lib.TextLayer({ textContentSource: p.proxy.streamTextContent({ includeMarkedContent: false }), container: p.tl, viewport: p.vp });
    p.textLayer = tlr; await tlr.render();
    if (p.tlKey === key && hooks.afterTextLayer) hooks.afterTextLayer(p);
  } catch (e) { if (p.tlKey === key) p.tlKey = ''; if (e?.name !== 'AbortException') console.warn('text layer', e); }
}
async function renderAnnotations(p) {
  if (p.annLayer || p.annBusy) return; p.annBusy = true;
  try {
    const annotations = await p.proxy.getAnnotations({ intent: 'display' });
    if (!annotations.length) return;
    const src = S.sources.get(p.src);
    const layer = new lib.AnnotationLayer({ div: p.al, page: p.proxy, viewport: p.vp.clone({ dontFlip: true }), annotationStorage: src.doc.annotationStorage, linkService });
    await layer.render({ annotations, renderForms: true, imageResourcesPath: '' });
    p.annLayer = layer;
    p.al.addEventListener('input', () => emit('form:change', p.src), { capture: true });
    p.al.addEventListener('change', () => emit('form:change', p.src), { capture: true });
  } catch (e) { console.warn('annotations', e); }
  finally { p.annBusy = false; }
}
function releaseCanvas(p) {
  if (!p.canvas) return;
  if (p.task) { try { p.task.cancel(); } catch {} p.task = null; }
  if (p.canvas.width) p.canvas.width = p.canvas.height = 0;
  p.key = ''; p.tl.innerHTML = ''; p.tlKey = ''; p.textLayer = null;
}

/* ---------- zoom and navigation ---------- */
export function zoomTo(scale, fit) {
  const sc = scroller(), top = sc.scrollTop; let anchor = null, frac = 0;
  for (const p of S.pages) { const s = p.sec; if (!s) continue; if (s.offsetTop + s.offsetHeight > top) { anchor = s; frac = (top - s.offsetTop) / s.offsetHeight; break; } }
  S.fit = fit || null; if (!fit) S.scale = Math.max(.2, Math.min(6, scale));
  layout();
  if (anchor) sc.scrollTop = anchor.offsetTop + frac * anchor.offsetHeight;
  updateNav();
}
export function currentPage() {
  const sc = scroller(), line = sc.scrollTop + Math.min(sc.clientHeight * .35, 260);
  for (let i = 0; i < S.pages.length; i++) { const s = S.pages[i].sec; if (s && s.offsetTop + s.offsetHeight > line) return i + 1; }
  return S.pages.length;
}
let navRaf = 0;
export function updateNav() {
  if (navRaf) return;
  navRaf = requestAnimationFrame(() => {
    navRaf = 0; const n = S.pages.length, inp = $('#pgIn');
    if (!S.doc || S.org || !n) { if (inp) { inp.value = ''; $('#pgOf').textContent = 'of 0'; } return; }
    const cur = currentPage(); $('#pgOf').textContent = 'of ' + n; inp.max = n;
    if (document.activeElement !== inp) inp.value = cur;
    $('#pgPrev').disabled = cur <= 1; $('#pgNext').disabled = cur >= n;
    emit('nav', cur);
  });
}
export function goTo(n, offsetPx = 0) {
  if (!S.doc || S.org) return; const N = S.pages.length; n = Math.max(1, Math.min(N, Math.round(n) || 1));
  const s = S.pages[n - 1].sec; if (s) scroller().scrollTop = s.offsetTop - 10 + offsetPx;
  const inp = $('#pgIn'); if (inp) inp.value = n; updateNav();
}
export function scrollToPagePoint(p, x, y) {
  // x, y in user space; scroll so the point sits about a third down the viewport
  if (!p.sec || !p.vp) return;
  const [vx, vy] = p.vp.convertToViewportPoint(x, y);
  const sc = scroller(); sc.scrollTop = p.sheet.offsetTop + vy - sc.clientHeight * .33;
}
export function rotatePage(p, deg) { p.rot = (p.rot + deg + 360) % 360; layout(); }
export function rerenderAll() { S.pages.forEach(p => { p.key = ''; p.tlKey = ''; if (p.visible) requestRender(p); }); }
export function invalidateAnnotations(p) { if (p.annLayer) { p.al.innerHTML = ''; p.annLayer = null; if (p.visible) requestRender(p); } }

export function initViewer() {
  const sc = scroller();
  sc.addEventListener('scroll', () => { noteScroll(); updateNav(); }, { passive: true });
  sc.addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey) || !S.doc) return; e.preventDefault(); zoomTo(S.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), null); }, { passive: false });
  $('#zoomIn').addEventListener('click', () => zoomTo(S.scale * 1.2, null));
  $('#zoomOut').addEventListener('click', () => zoomTo(S.scale / 1.2, null));
  $('#zoomFit').addEventListener('click', () => zoomTo(0, S.fit === 'width' ? 'page' : 'width'));
  $('#pgPrev').addEventListener('click', () => goTo(currentPage() - 1));
  $('#pgNext').addEventListener('click', () => goTo(currentPage() + 1));
  $('#pgIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goTo(+e.target.value); e.target.blur(); } else if (e.key === 'Escape') { e.target.blur(); updateNav(); } });
  $('#pgIn').addEventListener('change', () => goTo(+$('#pgIn').value));
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.fit && S.doc && !S.org) layout(); }, 150); });
  on('doc:open', () => { buildPages(); sc.scrollTop = 0; });
}

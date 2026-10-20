// OCR for scanned pages (tesseract.js, runs in the browser). Recognized words become a selectable,
// searchable text layer right away, and Save writes them into the PDF as invisible text so other
// viewers can search the file too. Needs the served or desktop build (the engine files live in /ocr).
import { createWorker } from 'tesseract.js';
import { pdfjsLib as lib } from './pdfjs.js';
import { S, on, emit, coveredWords } from './state.js';
import { rotOf, place } from './geometry.js';
import { applyHighlights, findState } from './search.js';
import { $, el, toast, plural } from './ui.js';
import { scroller } from './viewer.js';
import { markDirty } from './editor.js';
import { keyHooks } from './hooks.js';

export const ocrAvailable = () => !__OFFLINE__;
const DPI = 220;
let worker = null, running = false, cancel = false;

async function getWorker(onStatus) {
  if (worker) return worker;
  const base = new URL('ocr/', document.baseURI).href;
  worker = await createWorker('eng', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base, logger: m => { if (m.status && onStatus) onStatus(m); } });
  return worker;
}
async function renderForOcr(p) {
  const scale = DPI / 72, vp = p.proxy.getViewport({ scale, rotation: rotOf(p) });
  const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await p.proxy.render({ canvasContext: g, viewport: vp, annotationMode: lib.AnnotationMode.DISABLE }).promise;
  return { canvas: c, vp };
}
// Words are stored with the visual box corners mapped into PDF user space, plus the page rotation used.
async function ocrPage(p, w) {
  const { canvas, vp } = await renderForOcr(p);
  const { data } = await w.recognize(canvas, {}, { blocks: true });
  canvas.width = canvas.height = 0;
  const words = [];
  for (const b of data.blocks || []) for (const para of b.paragraphs) for (const line of para.lines) for (const wd of line.words) {
    const text = wd.text.trim(); if (!text || wd.confidence < 30) continue;
    const { x0, y0, x1, y1 } = wd.bbox;
    const tl = vp.convertToPdfPoint(x0, y0), br = vp.convertToPdfPoint(x1, y1);
    words.push({ text, tl, br, w: (x1 - x0) / vp.scale, h: (y1 - y0) / vp.scale, conf: Math.round(wd.confidence), eol: wd === line.words[line.words.length - 1] });
  }
  p.ocr = { words, rot: rotOf(p), at: Date.now() };
  p.text = null; p.edit = null; // search cache and editable blocks rebuilt with the new words
  renderOcrLayer(p);
  return words.length;
}
// Transparent, selectable spans in their own layer (pdf.js rotates its text layer with CSS, so OCR
// words are positioned with the viewer's own geometry instead). Rebuilt on every layout.
export function renderOcrLayer(p) {
  if (!p.ocrl) return;
  p.ocrl.innerHTML = ''; p.ocrDivs = [];
  if (!p.ocr || !p.vp) return;
  const frag = document.createDocumentFragment(), hidden = coveredWords(p);
  p.ocr.words.forEach((wd, i) => {
    const hpx = wd.h * S.scale;
    const span = el('span', { class: 'ocr', text: hidden.has(i) ? '' : wd.text + ' ', style: { fontSize: hpx * 0.85 + 'px', lineHeight: hpx + 'px' } });
    place(span, p, { x: wd.tl[0], y: wd.tl[1], h: wd.h, a: p.ocr.rot }); // no width: measured below
    frag.append(span); p.ocrDivs.push(span);
  });
  p.ocrl.append(frag);
  // stretch each span so the transparent text (and the selection drawn on it) covers the printed word exactly, as pdf.js does
  for (let i = 0; i < p.ocrDivs.length; i++) { const span = p.ocrDivs[i], want = p.ocr.words[i].w * S.scale, have = span.offsetWidth; if (have > 0 && Math.abs(have - want) > 0.5) span.style.transform = (span.style.transform ? span.style.transform + ' ' : '') + `scaleX(${want / have})`; }
  if (findState.hits.length) applyHighlights(p);
}
on('ocr:refresh', p => { if (p && p.ocr) { p.text = null; renderOcrLayer(p); } });
function needsOcr(p) { return !p.ocr; }
async function runOcr(pages) {
  if (running) return; running = true; cancel = false;
  const strip = el('div', { class: 'ocr-progress' }); const label = el('span', { text: 'Starting the text recognizer…' }), bar = el('progress', { max: pages.length, value: 0 }), stop = el('button', { class: 'mini', type: 'button', text: 'Stop', onclick: () => { cancel = true; } });
  strip.append(label, bar, stop); $('#ctx').innerHTML = ''; $('#ctx').append(strip);
  let done = 0, words = 0;
  try {
    const w = await getWorker(m => { if (m.status && m.progress < 1 && !done) label.textContent = `Loading the text recognizer (${m.status})…`; });
    for (const p of pages) {
      if (cancel || !S.pages.includes(p)) break;
      label.textContent = `Reading page ${S.pages.indexOf(p) + 1} of ${S.pages.length}…`;
      words += await ocrPage(p, w); done++; bar.value = done;
    }
    if (done) { markDirty(); toast(cancel ? `Stopped after ${plural(done, 'page')}. ${words} words recognized so far; they are searchable now and saved with the file.` : `Recognized ${words} words on ${plural(done, 'page')}. Text is now selectable and searchable, and will be saved into the file.`); }
  } catch (e) { console.error(e); toast('Text recognition failed: ' + (e.message || e)); }
  finally { running = false; emit('ctx'); emit('ocr:done'); }
}
function openOcr() {
  if (!S.doc || running) return;
  const noText = S.pages.filter(needsOcr);
  const m = el('div', { class: 'mback', id: 'ocrModal' });
  const scope = el('select', { class: 'ctl', id: 'ocrScope' });
  scope.append(el('option', { value: 'missing', text: `Pages not yet recognized (${noText.length})` }), el('option', { value: 'all', text: `All pages (${S.pages.length})` }), el('option', { value: 'current', text: 'Current page only' }));
  m.append(el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    el('h3', { text: 'Recognize text (OCR)' }),
    el('p', { class: 'lead', text: 'For scanned pages. The recognized words become selectable and searchable here, and are written into the saved copy as invisible text so Acrobat, Edge and e-filing systems can search it too. Nothing visible changes. Runs on this computer; about 3 to 6 seconds a page.' }),
    el('div', { class: 'frow' }, el('label', { text: 'Pages' }), scope),
    el('div', { class: 'mfoot' }, el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => m.remove() }), el('button', { class: 'btn primary', type: 'button', id: 'ocrGo', text: 'Start', onclick: () => {
      const v = scope.value; m.remove();
      let list = v === 'all' ? S.pages.slice() : v === 'current' ? [S.pages[currentIndex()]] : noText;
      if (!list.length) { toast('Every page has been recognized already.'); return; }
      runOcr(list);
    } }))));
  document.body.append(m); scope.focus();
}
function currentIndex() { const sc = scroller(), line = sc.scrollTop + 200; for (let i = 0; i < S.pages.length; i++) { const s = S.pages[i].sec; if (s && s.offsetTop + s.offsetHeight > line) return i; } return 0; }
export function init() {
  if (!ocrAvailable()) { $('#ocrBtn').hidden = true; return; }
  $('#ocrBtn').addEventListener('click', openOcr);
  keyHooks.push(e => { const m = $('#ocrModal'); if (m) { if (e.key === 'Escape') m.remove(); return true; } return false; });
  on('doc:close', () => { if (worker) { worker.terminate().catch(() => {}); worker = null; } });
}

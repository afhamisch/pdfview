// Saving: form values come out of pdf.js (saveDocument), then pdf-lib applies added objects, page
// order and rotation, Bates numbers, redactions and the editable layer, and drops unreferenced objects.
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFHexString, PDFTextField, PDFCheckBox, StandardFonts, rgb, degrees, BlendMode, LineCapStyle } from 'pdf-lib';
import { pdfjsLib as lib, docOptions } from './pdfjs.js';
import { S, on } from './state.js';
import { offset, rotOf } from './geometry.js';
import { $, toast, plural } from './ui.js';
import { EDIT_KEY, hash } from './document.js';
import { batesBox } from './bates.js';
import { markDirty } from './editor.js';
import { layoutLines, boxWidth, PAD, LINE } from './textstyle.js';
import { keyHooks } from './hooks.js';

const PN = k => PDFName.of(k);
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
function clean(str, font) { let out = ''; for (const ch of String(str).replace(/\t/g, '    ')) { if (ch === '\n') { out += ch; continue; } try { font.widthOfTextAtSize(ch, 10); out += ch; } catch { out += '?'; } } return out; }

/* ---------- redaction (ported from PDF Desk) ---------- */
async function rasterize(pp, rects) {
  const v1 = pp.getViewport({ scale: 1, rotation: 0 }); let sc = 200 / 72; const maxPx = 16e6;
  if (v1.width * v1.height * sc * sc > maxPx) sc = Math.sqrt(maxPx / (v1.width * v1.height));
  const vp = pp.getViewport({ scale: sc, rotation: 0 });
  const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await pp.render({ canvasContext: g, viewport: vp, annotationMode: lib.AnnotationMode.ENABLE }).promise;
  g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineWidth = 2; g.lineJoin = 'miter';
  for (const o of rects) { const pts = [[0, 0], [o.w, 0], [o.w, o.h], [0, o.h]].map(([u, v]) => vp.convertToViewportPoint(...offset([o.x, o.y], o.a, u, v))); g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill(); g.stroke(); }
  const blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('image')), 'image/jpeg', 0.92));
  c.width = c.height = 0; return new Uint8Array(await blob.arrayBuffer());
}
const PAGE_EXTRAS = ['Annots', 'Thumb', 'PieceInfo', 'Metadata', 'StructParents', 'B', 'AA', 'Group', 'Tabs', 'LastModified', 'SeparationInfo'];
function emptyPageNode(doc, node) { node.set(PN('Contents'), doc.context.obj([])); node.set(PN('Resources'), doc.context.obj({})); PAGE_EXTRAS.forEach(k => node.delete(PN(k))); }
async function applyRedactions(doc, idxs, rectsAt) {
  const bytes1 = await doc.save({ updateFieldAppearances: false });
  const d1 = await lib.getDocument(docOptions({ data: bytes1.slice() })).promise;
  const shots = [];
  try { for (const idx of idxs) { const pp = await d1.getPage(idx + 1); shots.push({ idx, view: pp.view.slice(), jpg: await rasterize(pp, rectsAt.get(idx) || []) }); } }
  finally { try { d1.destroy(); } catch {} }
  const pages = doc.getPages(), redRefs = new Set(idxs.map(i => pages[i].ref.tag));
  let form = null; try { form = doc.getForm(); } catch {}
  if (form) for (const f of form.getFields()) {
    let widgets; try { widgets = f.acroField.getWidgets(); } catch { continue; }
    const onRed = widgets.map(w => { try { return redRefs.has(form.findWidgetPage(w).ref.tag); } catch { return false; } });
    if (!onRed.some(Boolean)) continue;
    if (onRed.every(Boolean)) { try { form.removeField(f); } catch (e) { console.warn('remove field', e); } }
    else for (let i = onRed.length - 1; i >= 0; i--) if (onRed[i]) { try { f.acroField.removeWidget(i); } catch {} }
  }
  for (const s of shots) {
    const node = pages[s.idx].node, img = await doc.embedJpg(s.jpg), [x0, y0, x1, y1] = s.view, f = v => (+v).toFixed(4);
    const cs = doc.context.flateStream(`q\n${f(x1 - x0)} 0 0 ${f(y1 - y0)} ${f(x0)} ${f(y0)} cm\n/Redacted Do\nQ\n`);
    emptyPageNode(doc, node); node.set(PN('Contents'), doc.context.register(cs)); node.set(PN('Resources'), doc.context.obj({ XObject: { Redacted: img.ref } }));
  }
  const cat = doc.catalog; ['StructTreeRoot', 'MarkInfo', 'Metadata', 'PieceInfo', 'AA', 'SpiderInfo'].forEach(k => cat.delete(PN(k)));
  try { const oa = cat.lookup(PN('OpenAction')); if (oa instanceof PDFDict && String(oa.lookup(PN('S'))) === '/JavaScript') cat.delete(PN('OpenAction')); } catch {}
  try { const nm = cat.lookup(PN('Names')); if (nm instanceof PDFDict) ['EmbeddedFiles', 'JavaScript'].forEach(k => nm.delete(PN(k))); } catch {}
  try { const info = doc.context.lookup(doc.context.trailerInfo.Info); if (info instanceof PDFDict) ['Title', 'Author', 'Subject', 'Keywords', 'Creator'].forEach(k => info.delete(PN(k))); } catch {}
  doc.getPages().forEach(p => { let a; try { a = p.node.lookup(PN('Annots'), PDFArray); } catch { return; } if (!a) return; for (let i = a.size() - 1; i >= 0; i--) { try { const an = a.lookup(i, PDFDict); if (String(an.lookup(PN('Subtype'))) === '/FileAttachment') a.remove(i); } catch {} } });
}
function collectGarbage(doc) {
  const ctx = doc.context, seen = new Set(), stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt, ctx.trailerInfo.ID].filter(Boolean);
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) { if (seen.has(o.tag)) continue; seen.add(o.tag); const v = ctx.indirectObjects.get(o); if (v) stack.push(v); continue; }
    if (o instanceof PDFDict) { for (const [, v] of o.entries()) stack.push(v); }
    else if (o instanceof PDFArray) { for (let i = 0; i < o.size(); i++) stack.push(o.get(i)); }
    else if (o instanceof PDFStream) stack.push(o.dict);
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) ctx.delete(ref);
}
function redStats() { const live = new Set(S.pages.map(p => p.uid)); const rs = S.objects.filter(o => o.type === 'redact' && live.has(o.page)); return { n: rs.length, pages: new Set(rs.map(o => o.page)).size }; }

async function sourceBytes(src) {
  if (!S.formDirty.has(src.id)) return src.bytes;
  try { return await src.doc.saveDocument(); } catch (e) { console.warn('saveDocument', e); return src.bytes; }
}

/* Build the output PDF. Returns { bytes, redacted }. */
export async function buildPdf({ editLayer = true } = {}) {
  const doc = await PDFDocument.load(await sourceBytes(S.sources.get(0)), { ignoreEncryption: true, updateMetadata: false });
  const helv = await doc.embedFont(StandardFonts.Helvetica), helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontCache = new Map([['helv', helv], ['helv:b', helvB]]);
  const STD = { helv: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'], times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'], courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] };
  const fontFor = async o => { const fam = STD[o.font] ? o.font : 'helv', key = fam + (o.bold ? ':b' : '') + (o.italic ? ':i' : ''); if (!fontCache.has(key)) fontCache.set(key, await doc.embedFont(StandardFonts[STD[fam][(o.bold ? 1 : 0) + (o.italic ? 2 : 0)]])); return fontCache.get(key); };
  const flatten = $('#flatten').checked;
  const keptMain = new Set(S.pages.filter(p => p.src === 0).map(p => p.si));
  let form = null; try { form = doc.getForm(); } catch {}
  if (form && form.getFields().length) {
    if (flatten) { try { form.flatten(); } catch (e) { console.warn(e); toast('Some fields could not be flattened; they were saved as fillable.'); } }
    else {
      // fields that only lived on deleted pages are removed so they don't linger in the form
      for (const f of form.getFields()) {
        let widgets; try { widgets = f.acroField.getWidgets(); } catch { continue; }
        const pagesOf = widgets.map(w => { try { return doc.getPages().indexOf(form.findWidgetPage(w)); } catch { return -1; } });
        if (pagesOf.length && pagesOf.every(i => i >= 0 && !keptMain.has(i))) { try { form.removeField(f); } catch {} }
      }
    }
  }
  const mainPages = doc.getPages(), N0 = mainPages.length, target = new Map();
  S.pages.forEach(p => { if (p.src === 0) target.set(p.uid, mainPages[p.si]); });
  const bySrc = new Map();
  S.pages.forEach(p => { if (p.src) { if (!bySrc.has(p.src)) bySrc.set(p.src, []); bySrc.get(p.src).push(p); } });
  for (const [sid, list] of bySrc) {
    const src = S.sources.get(sid), sd = await PDFDocument.load(await sourceBytes(src), { ignoreEncryption: true, updateMetadata: false });
    try { const f = sd.getForm(); if (f.getFields().length) f.flatten(); } catch (e) { console.warn('flatten inserted file', e); }
    const batches = []; for (const p of list) { let b = batches.find(b => !b.has(p.si)); if (!b) { b = new Map(); batches.push(b); } b.set(p.si, p); }
    for (const b of batches) { const ps = [...b.values()]; const copied = await doc.copyPages(sd, ps.map(p => p.si)); ps.forEach((p, i) => target.set(p.uid, copied[i])); }
  }
  const imgCache = {}, layer = [], kept = [], redIdx = [], redRects = new Map();
  for (let idx = 0; idx < S.pages.length; idx++) {
    const p = S.pages[idx], page = target.get(p.uid);
    if (p.rot) page.setRotation(degrees(rotOf(p)));
    const objs = S.objects.filter(x => x.page === p.uid && x.type !== 'field');
    const bx = S.bates ? batesBox(p, idx, S.bates, (s, size) => helv.widthOfTextAtSize(s, size)) : null;
    if (p.ocr && p.ocr.words.length) {
      // recognized text goes in as invisible text so the file is searchable elsewhere; it does not change the page's look
      page.getContentStream(false);
      for (const wd of p.ocr.words) {
        const t = clean(wd.text, helv); if (!t.trim()) continue;
        const size = Math.max(2, Math.min(72, wd.h * 0.85)); const b = offset(wd.tl, p.ocr.rot, 0, wd.h * 0.8);
        page.drawText(t, { x: b[0], y: b[1], size, font: helv, color: rgb(0, 0, 0), opacity: 0, rotate: degrees(p.ocr.rot) });
      }
    }
    if (!objs.length && !bx) continue;
    const isRed = objs.some(o => o.type === 'redact');
    if (isRed) { redIdx.push(idx); redRects.set(idx, objs.filter(o => o.type === 'redact')); }
    page.getContentStream(false); // a fresh stream that holds only added items
    for (const o of objs) {
      const bl = offset([o.x, o.y], o.a, 0, o.h || 0), rot = degrees(o.a);
      if (o.type === 'whiteout') page.drawRectangle({ x: bl[0], y: bl[1], width: o.w, height: o.h, rotate: rot, color: rgb(1, 1, 1) });
      else if (o.type === 'redact') page.drawRectangle({ x: bl[0], y: bl[1], width: o.w, height: o.h, rotate: rot, color: rgb(0, 0, 0) });
      else if (o.type === 'highlight') page.drawRectangle({ x: bl[0], y: bl[1], width: o.w, height: o.h, rotate: rot, color: rgb(1, .83, 0), opacity: .42, blendMode: BlendMode.Multiply });
      else if (o.type === 'image') { const img = imgCache[o.src] || (imgCache[o.src] = await doc.embedPng(o.src)); page.drawImage(img, { x: bl[0], y: bl[1], width: o.w, height: o.h, rotate: rot }); }
      else if (o.type === 'check') { const pts = [[.12, .45], [.40, .82], [.90, .18]].map(([u, v]) => offset([o.x, o.y], o.a, u * o.w, v * o.h)); const th = Math.max(1, o.w * .13); for (let i = 0; i < 2; i++) page.drawLine({ start: { x: pts[i][0], y: pts[i][1] }, end: { x: pts[i + 1][0], y: pts[i + 1][1] }, thickness: th, color: hexRgb(o.color), lineCap: LineCapStyle.Round }); }
      else if (o.type === 'text' && o.box) {
        // stamp: bold text inside a border, sized from the text itself
        const font = helvB, lines = clean(o.text, font).split('\n'), padX = 6, padY = 3, lh = o.size * 1.15;
        const tw = Math.max(...lines.map(l => font.widthOfTextAtSize(l, o.size)), 1), bw = tw + 2 * padX, bh = lines.length * lh + 2 * padY;
        const corner = offset([o.x, o.y], o.a, 0, bh);
        page.drawRectangle({ x: corner[0], y: corner[1], width: bw, height: bh, rotate: rot, borderColor: hexRgb(o.color), borderWidth: 1.5 });
        lines.forEach((line, i) => { if (!line) return; const b = offset([o.x, o.y], o.a, padX, padY + lh * i + o.size * 0.93); page.drawText(line, { x: b[0], y: b[1], size: o.size, font, color: hexRgb(o.color), rotate: rot }); });
      }
      else if (o.type === 'text') {
        const font = await fontFor(o), measure = str => font.widthOfTextAtSize(clean(str, font), o.size);
        const lines = layoutLines(Object.assign({}, o, { text: clean(o.text, font) }), measure), W = boxWidth(o, lines), col = hexRgb(o.color);
        lines.forEach((ln, i) => {
          const base = PAD + o.size * (LINE * i + 0.93), ulY = base + o.size * 0.14, ulT = Math.max(.5, o.size * 0.06);
          let x = PAD; const avail = W - ln.indent;
          if (o.align === 'center') x += ln.indent + (avail - ln.width) / 2; else if (o.align === 'right') x += ln.indent + avail - ln.width; else x += ln.indent;
          if (ln.prefix) { const bp = offset([o.x, o.y], o.a, PAD, base); page.drawText(ln.prefix, { x: bp[0], y: bp[1], size: o.size, font, color: col, rotate: rot }); }
          if (!ln.text) return;
          if (ln.justify) {
            const gap = (avail - ln.words.reduce((a, w) => a + measure(w), 0)) / (ln.words.length - 1); let cx = PAD + ln.indent;
            for (const w of ln.words) { const b = offset([o.x, o.y], o.a, cx, base); page.drawText(w, { x: b[0], y: b[1], size: o.size, font, color: col, rotate: rot }); cx += measure(w) + gap; }
            if (o.underline) { const u0 = offset([o.x, o.y], o.a, PAD + ln.indent, ulY), u1 = offset([o.x, o.y], o.a, PAD + ln.indent + avail, ulY); page.drawLine({ start: { x: u0[0], y: u0[1] }, end: { x: u1[0], y: u1[1] }, thickness: ulT, color: col }); }
          } else {
            const b = offset([o.x, o.y], o.a, x, base); page.drawText(ln.text, { x: b[0], y: b[1], size: o.size, font, color: col, rotate: rot });
            if (o.underline) { const u0 = offset([o.x, o.y], o.a, x, ulY), u1 = offset([o.x, o.y], o.a, x + ln.width, ulY); page.drawLine({ start: { x: u0[0], y: u0[1] }, end: { x: u1[0], y: u1[1] }, thickness: ulT, color: col }); }
          }
        });
      }
      if (!isRed) { const c = Object.assign({}, o, { page: idx }); delete c.id; kept.push(c); }
    }
    if (bx) { const b = offset([bx.x, bx.y], bx.a, 0, bx.size * 0.8); page.drawText(bx.label, { x: b[0], y: b[1], size: bx.size, font: helv, color: rgb(0, 0, 0), rotate: degrees(bx.a) }); }
    if (isRed) continue;
    const ref = page.contentStreamRef;
    layer.push({ p: idx, ref: [ref.objectNumber, ref.generationNumber], h: hash(page.contentStream.getUnencodedContents()) });
  }
  mainPages.forEach((pg, i) => { if (!keptMain.has(i)) emptyPageNode(doc, pg.node); });
  const order = S.pages.map(p => target.get(p.uid));
  if (!(order.length === N0 && order.every((pg, i) => pg === mainPages[i]))) { order.forEach(pg => doc.addPage(pg)); for (let i = N0 - 1; i >= 0; i--) doc.removePage(i); }
  if (redIdx.length) await applyRedactions(doc, redIdx, redRects);
  collectGarbage(doc);
  if (editLayer && layer.length) doc.catalog.set(PN(EDIT_KEY), PDFHexString.fromText(JSON.stringify({ v: 2, pages: layer, objects: kept, bates: S.bates })));
  // object streams are off so the editable-layer marker stays visible to the quick check on reopen
  return { bytes: await doc.save({ updateFieldAppearances: false, useObjectStreams: false }), redacted: redIdx.length };
}
export function outputName(redacted) { return (S.name.replace(/\.pdf$/i, '') || 'document') + (redacted ? '-redacted.pdf' : '-edited.pdf'); }
let busy = false;
export async function save(confirmed) {
  if (!S.doc || busy) return;
  if (document.activeElement?.blur) document.activeElement.blur();
  const rst = redStats();
  if (rst.n && confirmed !== true) { $('#redLead').textContent = `${plural(rst.n, 'redaction')} on ${plural(rst.pages, 'page')} will be applied to the saved copy.`; $('#redModal').hidden = false; $('#redCancel').focus(); return; }
  const btn = $('#saveBtn'); busy = true; btn.disabled = true;
  try {
    const { bytes, redacted } = await buildPdf(); const filename = outputName(redacted);
    if (typeof window.pdfviewSaveHook === 'function') { const ok = await window.pdfviewSaveHook({ filename, bytes }); if (ok === false) { toast('Save cancelled.'); return; } }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    S.dirty = false; $('#dirtyDot').hidden = true;
    toast(redacted ? `Saved ${filename} with ${plural(rst.n, 'redaction')} applied.` : 'Saved ' + filename);
  } catch (e) { console.error(e); toast('This PDF could not be saved. It may be encrypted or damaged.'); }
  finally { busy = false; btn.disabled = false; }
}
export async function print() {
  if (!S.doc || busy) return; busy = true; $('#printBtn').disabled = true;
  try {
    const { bytes } = await buildPdf(); const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const w = window.open(url, '_blank'); if (!w) toast('Allow pop-ups for this page to print.'); else toast('The PDF opened in a new tab. Use the browser print button there (Ctrl+P).');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { console.error(e); toast('This PDF could not be prepared for printing.'); }
  finally { busy = false; $('#printBtn').disabled = false; }
}
export function init() {
  $('#saveBtn').addEventListener('click', () => save());
  $('#printBtn').addEventListener('click', print);
  $('#redCancel').addEventListener('click', () => $('#redModal').hidden = true);
  $('#redGo').addEventListener('click', () => { $('#redModal').hidden = true; save(true); });
  $('#redModal').addEventListener('pointerdown', e => { if (e.target.id === 'redModal') $('#redModal').hidden = true; });
  on('form:change', src => { S.formDirty.add(src); markDirty(); });
  keyHooks.push((e, { mod }) => {
    if (!$('#redModal').hidden) { if (e.key === 'Escape') $('#redModal').hidden = true; return true; }
    if (mod && e.key.toLowerCase() === 's' && S.doc) { e.preventDefault(); save(); return true; }
    if (mod && e.key.toLowerCase() === 'p' && S.doc) { e.preventDefault(); print(); return true; }
    return false;
  });
}

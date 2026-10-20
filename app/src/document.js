// Opening and closing documents, page records, and the editable layer that survives save and reopen.
import { PDFDocument, PDFName, PDFArray, PDFRef, PDFHexString, decodePDFRawStream } from 'pdf-lib';
import { pdfjs, docOptions } from './pdfjs.js';
import { S, emit, nextPuid, nextUid } from './state.js';
import { toast, plural } from './ui.js';

export const EDIT_KEY = 'EditLayer';
export function hash(u8) { let h = 0x811c9dc5; for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16) + ':' + u8.length; }
export const isPdf = f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);

// Fast check before paying for a full pdf-lib parse: the catalog key is written as a literal name.
function hasEditLayer(bytes) {
  const needle = '/' + EDIT_KEY; const n = needle.length;
  outer: for (let i = bytes.length - n; i >= 0; i--) { for (let j = 0; j < n; j++) if (bytes[i + j] !== needle.charCodeAt(j)) continue outer; return true; }
  return false;
}
// If this file was saved here before, pull the added items back out as editable objects and
// remove the content stream that drew them (ported from PDF Desk).
export async function prepare(bytes) {
  if (!hasEditLayer(bytes)) return { bytes };
  let doc; try { doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); } catch { return { bytes }; }
  const raw = doc.catalog.get(PDFName.of(EDIT_KEY));
  if (!raw || !raw.decodeText) return { bytes };
  let data; try { data = JSON.parse(raw.decodeText()); } catch { return { bytes, stale: true }; }
  try {
    for (const e of data.pages) {
      const arr = doc.getPage(e.p).node.Contents();
      if (!(arr instanceof PDFArray)) throw 0;
      let idx = -1;
      for (let i = 0; i < arr.size(); i++) { const r = arr.get(i); if (r instanceof PDFRef && r.objectNumber === e.ref[0] && r.generationNumber === e.ref[1]) { idx = i; break; } }
      if (idx < 0) throw 0;
      const st = doc.context.lookup(arr.get(idx));
      if (hash(decodePDFRawStream(st).decode()) !== e.h) throw 0;
      e._arr = arr; e._ref = arr.get(idx);
    }
  } catch { return { bytes, stale: true }; }
  data.pages.forEach(e => { const i = e._arr.indexOf(e._ref); if (i != null && i >= 0) e._arr.remove(i); doc.context.delete(e._ref); });
  doc.catalog.delete(PDFName.of(EDIT_KEY));
  return { bytes: await doc.save({ updateFieldAppearances: false }), objects: data.objects || [], bates: data.bates || null };
}

export function newPage(src, si, proxy) {
  const p = { uid: nextPuid(), src, si, proxy, base: proxy.rotate || 0, rot: 0, key: '', visible: false, tc: null, tkey: null, text: null };
  S.reg.set(p.uid, p); return p;
}
export function destroySources() { S.sources.forEach(s => { try { s.doc.destroy(); } catch {} }); }

export async function loadDoc(bytes) {
  const lib = await pdfjs();
  const task = lib.getDocument(docOptions({ data: bytes.slice() }));
  let needsPw = false; task.onPassword = () => { needsPw = true; task.destroy(); };
  try { return { doc: await task.promise }; } catch (e) { return { error: e, needsPw: needsPw || e?.name === 'PasswordException' }; }
}

const mark = n => { try { performance.mark('pdfview:' + n); } catch {} };
export async function openBytes(bytes, name, { sample = false, quiet = false } = {}) {
  mark('open-start');
  const prep = await prepare(bytes); bytes = prep.bytes; mark('prepared');
  const r = await loadDoc(bytes); mark('loaded');
  if (!r.doc) { console.error(r.error); toast(r.needsPw ? 'This PDF is password protected. Remove the password, then open it here.' : 'That file could not be opened as a PDF.'); return false; }
  const { doc } = r;
  destroySources();
  Object.assign(S, { doc, bytes, name, sample, pages: [], reg: new Map(), sources: new Map([[0, { id: 0, name, bytes, doc }]]), objects: [], sel: null, editing: null, undo: [], dirty: false, fit: 'width', org: false, osel: new Set(), anchor: null, bates: prep.bates || null, meta: {}, formDirty: new Set() });
  const proxies = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
  proxies.forEach((proxy, i) => S.pages.push(newPage(0, i, proxy))); mark('pages');
  S.objects = (prep.objects || []).filter(o => o.page >= 0 && o.page < doc.numPages).map(o => Object.assign({}, o, { id: nextUid(), page: S.pages[o.page].uid }));
  try { S.meta.outline = await doc.getOutline(); } catch { S.meta.outline = null; }
  mark('outline'); emit('doc:open'); mark('built');
  const k = S.objects.length;
  if (quiet) return true;
  if (prep.stale) toast('This PDF was changed in another program after it was saved here, so items added earlier are now part of the page and cannot be edited.');
  else if (k) toast(`Opened ${plural(doc.numPages, 'page')} with ${plural(k, 'added item')} you can still move, edit or delete.`);
  else if (!sample) {
    let scan = false; try { const tc = await proxies[0].getTextContent(); scan = tc.items.filter(i => i.str && i.str.trim()).length < 3; } catch {}
    toast(scan ? `Opened ${plural(doc.numPages, 'page')}. This looks like a scan with no text layer: use OCR to make the text selectable and searchable.` : `Opened ${plural(doc.numPages, 'page')}.`, scan ? 7000 : 3600);
  }
  return true;
}
export function closeDoc() {
  destroySources();
  Object.assign(S, { doc: null, bytes: null, name: '', sample: false, pages: [], reg: new Map(), sources: new Map(), objects: [], sel: null, editing: null, undo: [], dirty: false, org: false, osel: new Set(), anchor: null, bates: null, meta: {}, formDirty: new Set() });
  emit('doc:close');
}
export async function readFile(file) {
  if (!file) return;
  if (!isPdf(file)) { toast('Choose a PDF file.'); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return openBytes(bytes, file.name);
}
// Another PDF whose pages can be inserted.
export async function loadSource(file) {
  if (!file || !isPdf(file)) { toast('Choose a PDF file.'); return null; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await loadDoc(bytes);
  if (!r.doc) { toast(r.needsPw ? 'That PDF is password protected. Remove the password, then insert it.' : 'That file could not be opened as a PDF.'); return null; }
  return { id: S.sources.size ? Math.max(...S.sources.keys()) + 1 : 1, name: file.name, bytes, doc: r.doc };
}

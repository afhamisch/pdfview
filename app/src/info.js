// Document properties: what the file says about itself, with the fields you can change and a switch
// to strip them all on save.
import { S, emit, on } from './state.js';
import { pdfjsLib as lib } from './pdfjs.js';
import { $, el, toast, plural } from './ui.js';
import { libDoc } from './document.js';
import { markDirty } from './editor.js';
import { keyHooks } from './hooks.js';
import { PDFName, PDFDict } from 'pdf-lib';

const PAPER = { '612x792': 'Letter', '612x1008': 'Legal', '595x842': 'A4', '842x1191': 'A3', '792x1224': 'Tabloid', '420x595': 'A5' };
const fmtDate = s => { if (!s) return ''; let d = null; try { d = lib.PDFDateString.toDateObject(s); } catch {} if (!d && !isNaN(Date.parse(s))) d = new Date(s); return d ? d.toLocaleString() : String(s); };
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' bytes';
function pageSize(p) {
  const [x0, y0, x1, y1] = p.proxy.view, w = Math.round(x1 - x0), h = Math.round(y1 - y0);
  const name = PAPER[`${w}x${h}`] || PAPER[`${h}x${w}`];
  return `${(w / 72).toFixed(2).replace(/\.?0+$/, '')} × ${(h / 72).toFixed(2).replace(/\.?0+$/, '')} in${name ? ` (${name})` : ''}`;
}
async function fontList() {
  const out = new Map();
  try {
    const doc = await libDoc(), pages = doc.getPages(), N = Math.min(pages.length, 60);
    for (let i = 0; i < N; i++) {
      let fonts = null; try { fonts = pages[i].node.Resources()?.lookup(PDFName.of('Font')); } catch {}
      if (!(fonts instanceof PDFDict)) continue;
      for (const [, v] of fonts.entries()) {
        const d = doc.context.lookup(v); if (!(d instanceof PDFDict)) continue;
        const base = String(d.get(PDFName.of('BaseFont')) || '').replace(/^\//, '').replace(/^[A-Z]{6}\+/, ''); if (!base) continue;
        let desc = null; try { desc = doc.context.lookup(d.get(PDFName.of('FontDescriptor'))); if (!(desc instanceof PDFDict)) { const dfs = doc.context.lookup(d.get(PDFName.of('DescendantFonts'))); const d0 = dfs && dfs.get ? doc.context.lookup(dfs.get(0)) : null; desc = d0 instanceof PDFDict ? doc.context.lookup(d0.get(PDFName.of('FontDescriptor'))) : null; } } catch {}
        const emb = desc instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some(k => desc.has(PDFName.of(k)));
        if (!out.has(base)) out.set(base, { emb, type: String(d.get(PDFName.of('Subtype')) || '').replace(/^\//, '') });
      }
    }
    return { fonts: [...out.entries()], partial: pages.length > N };
  } catch (e) { console.warn('fonts', e); return { fonts: [...out.entries()], partial: false }; }
}
let modal = null;
export function closeInfo() { if (modal) { modal.remove(); modal = null; } }
export async function openInfo() {
  if (!S.doc || modal) return;
  const m = el('div', { class: 'mback', id: 'infoModal' }); modal = m;
  const box = el('div', { class: 'modal wide info', role: 'dialog', 'aria-modal': 'true' }, el('h3', { text: 'Document properties' }), el('p', { class: 'muted', text: 'Reading the file…' }));
  m.append(box); document.body.append(m);
  m.addEventListener('pointerdown', e => { if (e.target === m) closeInfo(); });
  let md = { info: {} }, att = null; try { md = await S.doc.getMetadata(); } catch {} try { att = await S.doc.getAttachments(); } catch {}
  const info = md.info || {}, edits = S.meta.edits || {}, head = new TextDecoder('latin1').decode(S.bytes.subarray(0, 1024)), ver = (head.match(/%PDF-(\d\.\d)/) || [])[1] || info.PDFFormatVersion || '';
  const xmp = md.metadata, xmpTitle = xmp && xmp.get ? (xmp.get('dc:title') || '') : '';
  const rows = el('dl', { class: 'props' });
  const row = (k, v) => { if (v == null || v === '') return; rows.append(el('dt', { text: k }), el('dd', { text: String(v) })); };
  row('File', S.name); row('Size', fmtSize(S.bytes.length)); row('Pages', S.pages.length); row('Page size', S.pages[0] ? pageSize(S.pages[0]) : '');
  row('PDF version', ver); row('Creator', info.Creator); row('Producer', info.Producer); row('Created', fmtDate(info.CreationDate)); row('Modified', fmtDate(info.ModDate));
  row('Forms', info.IsAcroFormPresent ? (info.IsXFAPresent ? 'Yes (XFA)' : 'Yes') : 'No'); row('Attachments', att ? plural(Object.keys(att).length, 'file') : 'None');
  row('XMP metadata', xmp ? (xmpTitle ? `Yes (title: ${xmpTitle})` : 'Yes') : 'None'); row('Language', info.Language);
  const field = (k, label) => { const i = el('input', { class: 'ctl', type: 'text', value: edits[k] != null ? edits[k] : (info[label] || ''), 'aria-label': label, dataset: { k } }); return el('label', { class: 'prow' }, el('span', { text: label }), i); };
  const form = el('div', { class: 'pform' }, field('title', 'Title'), field('author', 'Author'), field('subject', 'Subject'), field('keywords', 'Keywords'));
  const strip = el('input', { type: 'checkbox', id: 'stripMeta' }); strip.checked = !!S.meta.strip;
  const stripRow = el('label', { class: 'chk', title: 'Title, author, subject, keywords, creator, producer, dates and the XMP block are removed from the saved copy' }, strip, el('span', { text: 'Remove all metadata when saving' }));
  const fontsHost = el('div', { class: 'fonts' }, el('span', { class: 'muted', text: 'Reading fonts…' }));
  const apply = el('button', { class: 'btn primary', type: 'button', text: 'Apply', onclick: () => {
    const e = {}; form.querySelectorAll('input').forEach(i => { e[i.dataset.k] = i.value; });
    const changed = Object.keys(e).some(k => (e[k] || '') !== (info[{ title: 'Title', author: 'Author', subject: 'Subject', keywords: 'Keywords' }[k]] || ''));
    S.meta.edits = changed ? e : null; S.meta.strip = strip.checked;
    if (changed || strip.checked) { markDirty(); toast(strip.checked ? 'All metadata will be removed when you save.' : 'Properties updated. Save to write them into the file.'); }
    closeInfo();
  } });
  box.innerHTML = ''; box.append(el('h3', { text: 'Document properties' }), rows, el('h4', { text: 'Editable' }), form, stripRow, el('h4', { text: 'Fonts' }), fontsHost, el('div', { class: 'mfoot' }, el('button', { class: 'btn', type: 'button', text: 'Close', onclick: closeInfo }), apply));
  const { fonts, partial } = await fontList();
  fontsHost.innerHTML = '';
  if (!fonts.length) fontsHost.append(el('span', { class: 'muted', text: 'No fonts (scanned or image-only pages).' }));
  else { fonts.sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, f]) => fontsHost.append(el('span', { class: 'fchip', title: f.type, text: name + (f.emb ? '' : ' (not embedded)') }))); if (partial) fontsHost.append(el('span', { class: 'muted', text: ' (first 60 pages)' })); }
}
export function initInfo() {
  $('#infoBtn').addEventListener('click', openInfo);
  keyHooks.push(e => { if (modal && e.key === 'Escape') { closeInfo(); return true; } return false; });
  on('doc:close', closeInfo); on('tab:switch', closeInfo);
}
export { emit };

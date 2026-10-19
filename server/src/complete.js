import { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle } from 'pdf-lib';

// Geometry shared with the editor (ported from the original PDF Desk save code): a field is
// stored by its visual top-left corner, visual size and the page rotation at placement.
const frame = a => { const A = a * Math.PI / 180; return { c: Math.cos(A), s: Math.sin(A) }; };
const offset = (P, a, u, v) => { const { c, s } = frame(a); return [P[0] + u * c + v * s, P[1] + u * s - v * c]; };

const INK = rgb(0.07, 0.09, 0.14);
const MUTE = rgb(0.4, 0.43, 0.48);

function parsePngDataUrl(v) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ''));
  return m ? Buffer.from(m[1], 'base64') : null;
}

async function drawField(doc, page, field, helv, cache) {
  const { x, y, w, h, rot, type } = field;
  const value = field.value;
  if (value == null || value === '' || value === false) return;
  if (type === 'signature' || type === 'initials') {
    const png = parsePngDataUrl(value);
    if (!png) return;
    const key = value.slice(0, 200) + ':' + value.length;
    const img = cache.get(key) || (await doc.embedPng(png));
    cache.set(key, img);
    const sc = Math.min(w / img.width, h / img.height);
    const iw = img.width * sc, ih = img.height * sc;
    const tl = offset([x, y], rot, (w - iw) / 2, (h - ih) / 2);
    const bl = offset(tl, rot, 0, ih);
    page.drawImage(img, { x: bl[0], y: bl[1], width: iw, height: ih, rotate: degrees(rot) });
  } else if (type === 'checkbox') {
    if (value !== true && value !== 'true') return;
    const pts = [[0.12, 0.45], [0.4, 0.82], [0.9, 0.18]].map(([u, v]) => offset([x, y], rot, u * w, v * h));
    const th = Math.max(1, Math.min(w, h) * 0.13);
    for (let i = 0; i < 2; i++) {
      page.drawLine({ start: { x: pts[i][0], y: pts[i][1] }, end: { x: pts[i + 1][0], y: pts[i + 1][1] }, thickness: th, color: INK, lineCap: LineCapStyle.Round });
    }
  } else {
    const text = clean(String(value), helv);
    if (!text) return;
    const pad = 2;
    let size = Math.min(12, h * 0.6);
    while (size > 4 && helv.widthOfTextAtSize(text, size) > w - 2 * pad) size -= 0.5;
    const b = offset([x, y], rot, pad, (h + size * 0.7) / 2);
    page.drawText(text, { x: b[0], y: b[1], size, font: helv, color: INK, rotate: degrees(rot) });
  }
}

function clean(str, font) {
  let out = '';
  for (const ch of str.replace(/[\r\n\t]+/g, ' ')) {
    try { font.widthOfTextAtSize(ch, 10); out += ch; } catch { out += '?'; }
  }
  return out;
}

// Simple text layout for the certificate: wraps lines and starts new pages as needed.
class Writer {
  constructor(doc, fonts) {
    this.doc = doc; this.fonts = fonts; this.page = null; this.y = 0;
    this.margin = 54; this.width = 612 - 2 * 54;
  }
  newPage() { this.page = this.doc.addPage([612, 792]); this.y = 792 - this.margin; }
  ensure(h) { if (!this.page || this.y - h < this.margin) this.newPage(); }
  line(text, { size = 10, bold = false, color = INK, indent = 0, gap = 4 } = {}) {
    const font = bold ? this.fonts.bold : this.fonts.reg;
    const words = clean(text, font).split(' ');
    let cur = '';
    const flush = () => {
      this.ensure(size + gap);
      this.page.drawText(cur, { x: this.margin + indent, y: this.y - size, size, font, color });
      this.y -= size + gap;
      cur = '';
    };
    for (const wd of words) {
      const next = cur ? cur + ' ' + wd : wd;
      if (font.widthOfTextAtSize(next, size) > this.width - indent && cur) flush();
      cur = cur ? cur + ' ' + wd : wd;
    }
    if (cur) flush();
  }
  space(h = 8) { this.y -= h; }
  rule() { this.ensure(10); this.page.drawLine({ start: { x: this.margin, y: this.y - 2 }, end: { x: 612 - this.margin, y: this.y - 2 }, thickness: 0.6, color: rgb(0.78, 0.8, 0.84) }); this.y -= 10; }
}

// Builds the completed file: every document in order with its signed fields drawn, then the
// certificate pages. `data` is the full envelope shape plus `documentBytes(doc) -> Buffer`.
export async function buildCompleted(data, documentBytes) {
  const out = await PDFDocument.create();
  out.setTitle(data.title || 'Completed envelope');
  out.setProducer('PDFView');
  out.setCreator('PDFView');
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const cache = new Map();
  for (const d of data.documents) {
    const src = await PDFDocument.load(documentBytes(d), { ignoreEncryption: true, updateFieldAppearances: false });
    try { const f = src.getForm(); if (f.getFields().length) f.flatten(); } catch { /* no form or not flattenable; pages still copy */ }
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
    for (const f of data.fields) {
      if (f.document_id !== d.id || f.page < 0 || f.page >= pages.length) continue;
      await drawField(out, pages[f.page], f, helv, cache);
    }
  }

  const w = new Writer(out, { reg: helv, bold });
  w.newPage();
  w.line('Certificate of completion', { size: 18, bold: true, gap: 8 });
  w.line(`Envelope ID: ${data.id}`, { size: 10, color: MUTE });
  w.line(`Title: ${data.title}`);
  const done = data.completed_at || new Date().toISOString();
  w.line(`Completed: ${new Date(done).toUTCString()} (${done})`);
  w.space(); w.rule();

  w.line('Documents', { size: 12, bold: true, gap: 6 });
  for (const d of data.documents) {
    w.line(`${d.idx + 1}. ${d.name}, ${d.pages} page${d.pages === 1 ? '' : 's'}`);
    w.line(`SHA-256 of original: ${d.sha256}`, { size: 8, color: MUTE, indent: 14 });
  }
  w.space(); w.rule();

  w.line('Signers', { size: 12, bold: true, gap: 6 });
  for (const s of data.signers) {
    w.line(`${s.idx + 1}. ${s.name} <${s.email}>, ${s.status}`);
    if (s.signed_at) w.line(`Signed ${new Date(s.signed_at).toUTCString()} from ${s.signed_ip || 'unknown IP'}`, { size: 9, color: MUTE, indent: 14 });
  }
  w.space(); w.rule();

  w.line('Events', { size: 12, bold: true, gap: 6 });
  const byId = new Map(data.signers.map(s => [s.id, s.name]));
  for (const e of data.events) {
    const who = e.signer_id ? byId.get(e.signer_id) || 'signer' : 'sender';
    w.line(`${e.at}  ${e.type}  ${who}  ${e.ip || ''}`, { size: 8.5 });
    if (e.user_agent) w.line(String(e.user_agent).slice(0, 60), { size: 7.5, color: MUTE, indent: 14, gap: 5 });
  }
  w.space(); w.rule();
  w.line('The SHA-256 of this completed file is recorded in the envelope audit record kept by the sender.', { size: 8.5, color: MUTE });
  return out.save();
}

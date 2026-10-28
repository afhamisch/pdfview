// Node check of the white-out scrub: glyphs under a box leave the content stream, the rest of the
// line keeps its place, for a plain Tj, a TJ array with kerning, and a ' (next-line) operator.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import zlib from 'node:zlib';
import { scrubText, collectGarbage } from '../src/textedit.js';
import { PDFRawStream, decodePDFRawStream } from 'pdf-lib';
const here = new URL('.', import.meta.url).pathname, base = here + '../../node_modules/pdfjs-dist/';
const opts = data => ({ data, standardFontDataUrl: base + 'standard_fonts/', cMapUrl: base + 'cmaps/', cMapPacked: true, wasmUrl: base + 'wasm/' });
async function items(b) { const d = await getDocument(opts(b.slice())).promise; const pg = await d.getPage(1); const tc = await pg.getTextContent({ includeMarkedContent: false }); await d.cleanup?.(); return tc.items.filter(i => i.str.trim()).map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5] })); }
const doc = await PDFDocument.create(); const page = doc.addPage([612, 792]); const font = await doc.embedFont(StandardFonts.Helvetica);
const key = page.node.newFontDictionary(font.name, font.ref).decodeText();
const W = s => font.widthOfTextAtSize(s, 12);
const content = `BT /${key} 12 Tf 100 700 Td (Defendant John Doe moves) Tj ET
BT /${key} 12 Tf 100 650 Td [(Defendant ) -500 (John Doe) -500 ( moves)] TJ ET
BT /${key} 12 Tf 14 TL 100 614 Td (first line) Tj (Defendant John Doe moves) ' ET`;
page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
const before = await items(await doc.save());
// boxes over "John Doe" on each line (the TJ line has 6 units of kerning before it)
const x0 = 100 + W('Defendant '), x1 = x0 + W('John Doe');
const box = (y, dx = 0) => ({ kind: 'rect', x: x0 + dx - 1, y: y + 10, w: x1 - x0 + 2, h: 14, a: 0 });
const r = await scrubText(doc, page, [box(700), box(650, 6), box(600)]);
collectGarbage(doc); const out = await doc.save({ useObjectStreams: false }); const after = await items(out);
// every stream in the file, inflated, plus the raw bytes: the removed words are nowhere
const chk = await PDFDocument.load(out); let trace = Buffer.from(out).toString('latin1').includes('John Doe');
for (const [, o] of chk.context.enumerateIndirectObjects()) if (o instanceof PDFRawStream) { try { if (Buffer.from(decodePDFRawStream(o).decode()).toString('latin1').includes('John Doe')) trace = true; } catch {} }
const stream = zlib.inflateSync(Buffer.from(doc.context.lookup(page.node.Contents().get(0)).contents)).toString('latin1');
const joined = after.map(i => i.str).join(' | ');
const expectMovesX = 100 + W('Defendant John Doe ');
const movesAfter = after.filter(i => /moves/.test(i.str));
const res = {
  removed: r.removed, flagged: r.flagged,
  beforeLines: before.length, afterItems: after.map(i => `${i.str}@${i.x.toFixed(1)},${i.y.toFixed(0)}`),
  johnGone: !/John|Doe/.test(joined), defendantKept: (joined.match(/Defendant/g) || []).length, movesKept: movesAfter.length,
  movesInPlace: movesAfter.every(i => Math.abs(i.x - (expectMovesX + (i.y === 650 ? 12 : 0)) - (i.str.startsWith(' ') ? 0 : 0)) < 1.5),
  firstLineKept: /first line/.test(joined), noTjLeft: !/John/.test(stream), tjCount: (stream.match(/\] TJ/g) || []).length, traceInFile: trace
};
console.log(JSON.stringify(res, null, 1));
if (!(res.removed === 24 && !res.flagged && res.johnGone && res.defendantKept === 3 && res.movesKept === 3 && res.firstLineKept && res.tjCount === 3 && !res.traceInFile)) { console.log('FAILED'); process.exit(1); }

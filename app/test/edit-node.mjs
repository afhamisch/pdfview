// Node check of the text-editing core: blocks found, a block removed, nothing else moved.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs';
import { analyzePage, removeBlock, chooseFont } from '../src/textedit.js';
const here = new URL('.', import.meta.url).pathname, base = here + '../../node_modules/pdfjs-dist/';
const opts = data => ({ data, standardFontDataUrl: base + 'standard_fonts/', cMapUrl: base + 'cmaps/', cMapPacked: true, wasmUrl: base + 'wasm/' });
const file = process.argv[2] || here + 'fixtures/wordlike.pdf', pageIndex = +(process.argv[3] || 0), which = +(process.argv[4] || 1);
const bytes = new Uint8Array(fs.readFileSync(file));
async function items(b) { const d = await getDocument(opts(b.slice())).promise; const pg = await d.getPage(pageIndex + 1); const tc = await pg.getTextContent({ includeMarkedContent: false }); await d.cleanup?.(); return tc; }
const tc = await items(bytes);
const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
const an = await analyzePage(doc, pageIndex, tc.items, tc.styles);
console.log('ops', an.ops.length, 'unknown', an.ops.filter(o => !o.known).length, 'blocks', an.blocks.length);
an.blocks.forEach((b, i) => console.log(i, JSON.stringify(b.text).slice(0, 70), 'size', b.size.toFixed(1), 'lead', b.lead.toFixed(2), b.align, 'ops', b.ops.join(','), b.covered ? 'COVERED' : '', b.color, b.fontInfo ? b.fontInfo.base + ' ' + JSON.stringify(chooseFont(b.fontInfo, { tinos: { custom: 1 }, arimo: { custom: 1 }, cousine: { custom: 1 } })) : 'nofont'));
const bl = an.blocks[which]; if (!bl) process.exit(0);
removeBlock(doc, pageIndex, an, bl);
const out = await doc.save({ updateFieldAppearances: false }); fs.writeFileSync((process.env.TMPDIR || '/tmp') + '/pdfview-edited.pdf', out);
const tc2 = await items(new Uint8Array(out));
const gone = new Set(bl.idxs.map(i => tc.items[i].str).filter(s => s.trim()));
const strs2 = tc2.items.map(i => i.str);
console.log('removed strings still present:', [...gone].filter(s => strs2.includes(s)).length, 'of', gone.size);
const keyOf = it => it.str + '@' + it.transform.map(v => v.toFixed(2)).join(',');
const before = tc.items.filter((it, i) => !bl.idxs.includes(i) && it.str.trim()).map(keyOf), after = new Set(tc2.items.map(keyOf));
const moved = before.filter(k => !after.has(k));
console.log('untouched items moved or missing:', moved.length, 'of', before.length, moved.slice(0, 5));

// Editing text that is already on the page. pdf.js tells us where the words are; the content stream
// tells us which operators drew them. Lifting a block removes those operators from the page and
// hands back a text object with the same wording, size, color and font family, which the editor
// then treats like any text it added itself. Pure pdf-lib + content.js: no DOM, so tests run in Node.
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFRef, PDFStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { walkText, removeOps } from './content.js';
import { measureItems, groupBlocks, finishBlock } from './blocks.js';

const PN = k => PDFName.of(k);
const numOf = v => v instanceof PDFNumber ? v.asNumber() : typeof v === 'number' ? v : 0;

/* ---------- fonts: what a resource font is, and how wide its glyphs are ---------- */
let scratch = null; const stdCache = new Map();
async function stdFont(name) {
  if (!stdCache.has(name)) { scratch = scratch || await PDFDocument.create(); stdCache.set(name, await scratch.embedFont(StandardFonts[name])); }
  return stdCache.get(name);
}
export function stdName(base) {
  const b = base.toLowerCase(), bold = /bold|black|heavy|semibold|demibold/.test(b), ital = /italic|oblique/.test(b);
  if (/courier|mono/.test(b)) return ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'][(bold ? 1 : 0) + (ital ? 2 : 0)];
  if (/times|serif|roman|georgia|garamond|book/.test(b)) return ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'][(bold ? 1 : 0) + (ital ? 2 : 0)];
  if (/symbol/.test(b)) return 'Symbol'; if (/zapf|dingbat/.test(b)) return 'ZapfDingbats';
  return ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'][(bold ? 1 : 0) + (ital ? 2 : 0)];
}
function parseW(ctx, w) { // CID font /W array -> Map(cid -> width)
  const out = new Map(); if (!(w instanceof PDFArray)) return out;
  const a = w.asArray().map(v => ctx.lookup(v));
  for (let i = 0; i < a.length;) {
    const c = numOf(a[i]);
    if (a[i + 1] instanceof PDFArray) { a[i + 1].asArray().forEach((v, k) => out.set(c + k, numOf(ctx.lookup(v)))); i += 2; }
    else { const c2 = numOf(a[i + 1]), wv = numOf(a[i + 2]); if (c2 - c < 65536) for (let k = c; k <= c2; k++) out.set(k, wv); i += 3; }
  }
  return out;
}
/* Describe a font dictionary: family hints and an adv(bytes) that sums glyph widths in text space. */
export async function fontInfo(doc, dict) {
  const ctx = doc.context, get = (d, k) => { try { return ctx.lookup(d.get(PN(k))); } catch { return undefined; } };
  const sub = String(get(dict, 'Subtype') || ''), rawBase = String(get(dict, 'BaseFont') || '').replace(/^\//, ''), base = rawBase.replace(/^[A-Z]{6}\+/, '');
  let desc = get(dict, 'FontDescriptor'), fdict = dict, twoByte = false, known = true;
  if (sub === '/Type0') {
    const dfs = get(dict, 'DescendantFonts'); fdict = dfs instanceof PDFArray ? ctx.lookup(dfs.get(0)) : null;
    const enc = get(dict, 'Encoding'); twoByte = true; known = /^\/Identity-[HV]$/.test(String(enc || ''));
    if (fdict instanceof PDFDict) desc = get(fdict, 'FontDescriptor');
  }
  const flags = desc instanceof PDFDict ? numOf(get(desc, 'Flags')) : 0, weight = desc instanceof PDFDict ? numOf(get(desc, 'FontWeight')) : 0, stemV = desc instanceof PDFDict ? numOf(get(desc, 'StemV')) : 0, angle = desc instanceof PDFDict ? numOf(get(desc, 'ItalicAngle')) : 0;
  const missing = desc instanceof PDFDict ? numOf(get(desc, 'MissingWidth')) : 0;
  const lower = base.toLowerCase();
  const bold = /bold|black|heavy|semibold|demibold|extrabold|ultrabold/.test(lower) || weight >= 600 || !!(flags & (1 << 18)) || (stemV > 120 && !/light|regular/.test(lower));
  const italic = /italic|oblique/.test(lower) || !!(flags & 64) || angle !== 0;
  const serif = !!(flags & 2) || /times|serif|roman|georgia|garamond|baskerville|book|palatino|cambria|century|minion|crimson|tinos/.test(lower);
  const mono = !!(flags & 1) || /courier|mono|consol/.test(lower);
  let adv = null;
  if (sub === '/Type0') {
    if (known && fdict instanceof PDFDict) {
      const W = parseW(ctx, get(fdict, 'W')), dw = get(fdict, 'DW') != null ? numOf(get(fdict, 'DW')) : 1000;
      adv = bytes => { let w = 0, n = 0; for (let i = 0; i + 1 < bytes.length; i += 2) { const cid = bytes[i] * 256 + bytes[i + 1]; w += (W.has(cid) ? W.get(cid) : dw) / 1000; n++; } return { w, n, spaces: 0 }; };
    }
  } else {
    const widths = get(dict, 'Widths'), first = numOf(get(dict, 'FirstChar'));
    if (widths instanceof PDFArray) {
      const arr = widths.asArray().map(v => numOf(ctx.lookup(v)));
      let scale = 1 / 1000; if (sub === '/Type3') { const fm = get(dict, 'FontMatrix'); if (fm instanceof PDFArray) scale = numOf(ctx.lookup(fm.get(0))); }
      adv = bytes => { let w = 0, spaces = 0; for (const c of bytes) { const k = c - first; w += (k >= 0 && k < arr.length ? arr[k] : missing) * scale; if (c === 32) spaces++; } return { w, n: bytes.length, spaces }; };
    } else if (sub !== '/Type3') {
      let f = null; try { f = await stdFont(stdName(base)); } catch {}
      if (f) adv = bytes => { let w = 0, spaces = 0; for (const c of bytes) { try { w += f.widthOfTextAtSize(String.fromCharCode(c), 1000) / 1000; } catch { w += 0.5; } if (c === 32) spaces++; } return { w, n: bytes.length, spaces }; };
    }
  }
  return { base, bold, italic, serif, mono, twoByte, adv };
}
/* Pick one of the editor's fonts for a page font. FONTS is the editor's font table (ids -> labels). */
export function chooseFont(info, FONTS) {
  const name = info.base.toLowerCase().replace(/[^a-z0-9]/g, '');
  const has = id => FONTS && FONTS[id] ? id : null;
  const custom = Object.keys(FONTS || {}).filter(id => FONTS[id].custom).map(id => [id, id.toLowerCase().replace(/[^a-z0-9]/g, ''), String(FONTS[id].label || '').toLowerCase().replace(/[^a-z0-9]/g, '')]);
  let font = null;
  for (const [id, key, label] of custom) if ((key.length > 3 && name.includes(key)) || (label.length > 3 && name.includes(label.split('(')[0]))) { font = id; break; }
  if (!font) {
    if (/times|liberationserif|tinos|nimbusroman/.test(name)) font = has('tinos') || 'times';
    else if (/arial|helvetica|liberationsans|arimo|nimbussans/.test(name)) font = has('arimo') || 'helv';
    else if (/courier|liberationmono|cousine|nimbusmono/.test(name)) font = has('cousine') || 'courier';
    else if (/garamond/.test(name)) font = has('ebgaramond'); else if (/baskerville/.test(name)) font = has('baskerville'); else if (/crimson/.test(name)) font = has('crimson');
    else if (/bookantiqua|palatino|palladio/.test(name)) font = has('bookantiqua') || has('palatino') || has('p052');
    else if (/dejavusans/.test(name)) font = has('dejavusans'); else if (/dejavuserif/.test(name)) font = has('dejavuserif');
  }
  if (!font) font = info.mono ? (has('cousine') || 'courier') : info.serif ? (has('tinos') || 'times') : (has('arimo') || 'helv');
  return { font, bold: !!info.bold, italic: !!info.italic };
}

/* ---------- page content: operators, blocks and the matching between them ---------- */
export function pageContent(doc, page) {
  const ctx = doc.context, c = page.node.Contents(); if (!c) return { bytes: new Uint8Array(0), refs: [] };
  const refs = c instanceof PDFArray ? c.asArray() : [c]; const chunks = [];
  for (const r of refs) { const st = ctx.lookup(r); if (st instanceof PDFStream) { chunks.push(decodePDFRawStream(st).decode(), Uint8Array.of(10)); } }
  const n = chunks.reduce((a, b) => a + b.length, 0), out = new Uint8Array(n); let o = 0; for (const ch of chunks) { out.set(ch, o); o += ch.length; }
  return { bytes: out, refs };
}
export async function pageFonts(doc, page) {
  const ctx = doc.context, out = new Map();
  let fonts = null; try { fonts = page.node.Resources()?.lookup(PN('Font')); } catch {}
  if (fonts instanceof PDFDict) for (const [k, v] of fonts.entries()) { const d = ctx.lookup(v); if (d instanceof PDFDict) { try { out.set(k.decodeText(), await fontInfo(doc, d)); } catch (e) { console.warn('font', k, e); } } }
  return out;
}
/* Everything the editor needs for one page: the blocks, with each block knowing its operators. */
export async function analyzePage(doc, pageIndex, items, styles) {
  const page = doc.getPage(pageIndex), fonts = await pageFonts(doc, page), { bytes } = pageContent(doc, page);
  const ops = walkText(bytes, name => fonts.get(name) || null);
  const ms = measureItems(items, styles), itemOps = ms.map(() => new Set()), opItems = ops.map(() => new Set());
  const link = (i, j) => { itemOps[i].add(j); opItems[j].add(i); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  // an operator belongs to the item whose span its start point falls in, on the same baseline
  ops.forEach(op => {
    if (!op.known || !op.strings.length) return;
    let best = null, bd = Infinity;
    for (const m of ms) {
      if (m.fake || dot(m.u, op.dir) < 0.99) continue;
      const rel = [op.pos[0] - (m.s0 * m.u[0] + m.b * m.n[0]), op.pos[1] - (m.s0 * m.u[1] + m.b * m.n[1])];
      const along = dot(rel, m.u), off = Math.abs(dot(rel, m.n));
      if (off > 0.5 * Math.max(1, m.size * 0.3) || along < -0.5 || along > (m.s1 - m.s0) + 0.5) continue;
      const d = Math.abs(along) + off; if (d < bd) { bd = d; best = m; }
    }
    if (best) link(best.idx, op.i);
  });
  // items that start inside an operator's own run (one operator, several items)
  ms.forEach(m => {
    if (m.fake || itemOps[m.idx].size) return;
    let best = null, bd = Infinity;
    for (const op of ops) {
      if (!op.known || op.adv == null || dot(m.u, op.dir) < 0.99) continue;
      const rel = [m.s0 * m.u[0] + m.b * m.n[0] - op.pos[0], m.s0 * m.u[1] + m.b * m.n[1] - op.pos[1]];
      const along = dot(rel, op.dir), off = Math.abs(dot(rel, [-op.dir[1], op.dir[0]]));
      if (off > 0.5 * Math.max(1, m.size * 0.3) || along < -0.5 || along > op.adv * Math.hypot(op.dir[0], op.dir[1]) * (op.size / (op.tfs || 1)) + 0.5) continue;
      if (along < bd) { bd = along; best = op; }
    }
    if (best) link(m.idx, best.i);
  });
  // operators whose position could not be followed ride with the previous operator in the same BT
  ops.forEach(op => { if (op.known || !op.strings.length) return; for (let j = op.i - 1; j >= 0 && ops[j].bt === op.bt; j--) if (opItems[j].size) { for (const i of opItems[j]) link(i, op.i); return; } });
  const groups = groupBlocks(ms);
  // merge groups that share an operator, so an operator is always removed whole
  const parent = groups.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const owner = new Map();
  groups.forEach((g, gi) => g.forEach(idx => { for (const k of itemOps[idx]) { if (owner.has(k)) { const a = find(gi), b = find(owner.get(k)); if (a !== b) parent[a] = b; } else owner.set(k, gi); } }));
  const merged = new Map(); groups.forEach((g, gi) => { const r = find(gi); if (!merged.has(r)) merged.set(r, []); merged.get(r).push(...g); });
  const blocks = [];
  for (const g of merged.values()) {
    const bl = finishBlock(ms, g); if (!bl) continue;
    const opSet = new Set(); let covered = false;
    for (const i of bl.idxs) { const m = ms[i]; if (m.fake) continue; if (!itemOps[i].size) covered = true; for (const k of itemOps[i]) opSet.add(k); }
    bl.ops = [...opSet].sort((a, b) => a - b); bl.covered = covered || !bl.ops.length;
    const first = bl.ops.length ? ops[bl.ops[0]] : null;
    bl.color = first ? first.color : null; bl.fontInfo = first && first.fontName != null ? fonts.get(first.fontName) || null : null;
    blocks.push(bl);
  }
  return { blocks, ops, bytes };
}
/* Take a block's operators out of the page. Returns what undo needs to put them back. */
export function removeBlock(doc, pageIndex, analysis, bl) {
  const page = doc.getPage(pageIndex), ctx = doc.context, node = page.node;
  const prev = node.get(PN('Contents'));
  const out = removeOps(analysis.bytes, analysis.ops, new Set(bl.ops));
  const ref = ctx.register(ctx.flateStream(out));
  node.set(PN('Contents'), ctx.obj([ref]));
  return { pageIndex, prev, ref };
}
export function restoreContents(doc, rec) {
  const node = doc.getPage(rec.pageIndex).node;
  if (rec.prev) node.set(PN('Contents'), rec.prev); else node.delete(PN('Contents'));
  if (rec.ref instanceof PDFRef) doc.context.delete(rec.ref);
}

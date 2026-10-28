// Editing text that is already on the page. pdf.js tells us where the words are; the content stream
// tells us which operators drew them. Lifting a block removes those operators from the page and
// hands back a text object with the same wording, size, color and font family, which the editor
// then treats like any text it added itself. Pure pdf-lib + content.js: no DOM, so tests run in Node.
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFRef, PDFStream, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { walkText, removeOps, rewriteOps } from './content.js';
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
  // a stream pdf-lib itself added in this session (flattened fields, drawn items) is not a raw stream yet
  for (const r of refs) { const st = ctx.lookup(r); if (st instanceof PDFRawStream) chunks.push(decodePDFRawStream(st).decode(), Uint8Array.of(10)); else if (st instanceof PDFStream && typeof st.getUnencodedContents === 'function') chunks.push(st.getUnencodedContents(), Uint8Array.of(10)); }
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
  if (rec.kind === 'annots') { if (rec.prev) node.set(PN('Annots'), rec.prev); else node.delete(PN('Annots')); return; } // a mark taken out of the file (annots.js)
  if (rec.prev) node.set(PN('Contents'), rec.prev); else node.delete(PN('Contents'));
  if (rec.ref instanceof PDFRef) doc.context.delete(rec.ref);
}

/* ---------- white-out and eraser: the words underneath leave the file ---------- */
const hexOf = b => { let h = ''; for (const c of b) h += c.toString(16).padStart(2, '0'); return '<' + h + '>'; };
const fmt = v => (Math.round(v * 100) / 100).toString();
/* Is page point q inside region r (a white-out box, or within an eraser stroke)? */
export function inRegion(r, q) {
  if (r.kind === 'rect') { const A = (r.a || 0) * Math.PI / 180, c = Math.cos(A), s = Math.sin(A), dx = q[0] - r.x, dy = q[1] - r.y, u = dx * c + dy * s, v = dx * s - dy * c; return u >= 0 && u <= r.w && v >= 0 && v <= r.h; }
  const pts = r.pts || [], tol = (r.width || 0) / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - ax) * vx + (q[1] - ay) * vy) / L));
    if (Math.hypot(q[0] - (ax + t * vx), q[1] - (ay + t * vy)) <= tol) return true;
  }
  return pts.length === 1 && Math.hypot(q[0] - pts[0][0], q[1] - pts[0][1]) <= tol;
}
function regionBox(r) {
  if (r.kind === 'rect') { const A = (r.a || 0) * Math.PI / 180, c = Math.cos(A), s = Math.sin(A); const cs = [[0, 0], [r.w, 0], [0, r.h], [r.w, r.h]].map(([u, v]) => [r.x + u * c + v * s, r.y + u * s - v * c]); return [Math.min(...cs.map(p => p[0])), Math.min(...cs.map(p => p[1])), Math.max(...cs.map(p => p[0])), Math.max(...cs.map(p => p[1]))]; }
  const t = (r.width || 0) / 2, xs = r.pts.map(p => p[0]), ys = r.pts.map(p => p[1]); return [Math.min(...xs) - t, Math.min(...ys) - t, Math.max(...xs) + t, Math.max(...ys) + t];
}
/* The glyphs of one operator with their span along the baseline (same units as op.adv) and center on the page. */
export function opGlyphs(op, font) {
  if (!font || !font.adv || !op.sx || !(op.tfs * op.th)) return null;
  const step = font.twoByte ? 2 : 1, out = []; let cur = 0;
  const nx = -op.dir[1], ny = op.dir[0], up = op.size * 0.35;
  for (const part of op.parts || []) {
    if (typeof part === 'number') { cur -= part / 1000 * op.tfs * op.th; continue; }
    if (!(part instanceof Uint8Array)) continue;
    for (let i = 0; i + step - 1 < part.length; i += step) {
      const code = part.subarray(i, i + step), a = font.adv(code); if (!a) return null;
      const gw = (a.w * op.tfs + a.n * op.tc + a.spaces * op.tw) * op.th, mid = (cur + gw / 2) * op.sx;
      out.push({ part, i, gw, center: [op.pos[0] + op.dir[0] * mid + nx * up, op.pos[1] + op.dir[1] * mid + ny * up] });
      cur += gw;
    }
  }
  return out;
}
/* Remove the glyphs whose centers fall in the regions. Partly covered operators are rewritten as a TJ
   array with a kerning number in place of the removed glyphs, so the rest of the line keeps its place.
   Returns { removed, flagged }: flagged means something under a region may remain (text drawn through
   a form XObject, or a font whose widths are unknown), so the caller can say so. */
export async function scrubText(doc, page, regions) {
  if (!regions.length) return { removed: 0, flagged: false };
  const fonts = await pageFonts(doc, page), { bytes } = pageContent(doc, page);
  const fontOf = name => fonts.get(name) || null;
  const boxes = regions.map(regionBox), covered = q => regions.some(r => inRegion(r, q));
  const overlaps = b => boxes.some(x => b[0] <= x[2] && b[2] >= x[0] && b[1] <= x[3] && b[3] >= x[1]);
  let flagged = false;
  // text inside a form XObject placed over a region cannot be reached from here
  const check = ops => {
    let xo = null; try { xo = page.node.Resources()?.lookup(PN('XObject')); } catch {}
    for (const d of ops.xobjs || []) {
      let dict = null; try { dict = xo instanceof PDFDict ? doc.context.lookup(xo.get(PN(d.name))) : null; } catch {}
      if (!(dict instanceof PDFStream) || String(dict.dict.get(PN('Subtype')) || '') !== '/Form') continue;
      let bb = [0, 0, 1, 1], mt = [1, 0, 0, 1, 0, 0];
      try { const b = dict.dict.lookup(PN('BBox')); if (b instanceof PDFArray) bb = b.asArray().map(v => numOf(doc.context.lookup(v))); const m = dict.dict.lookup(PN('Matrix')); if (m instanceof PDFArray) mt = m.asArray().map(v => numOf(doc.context.lookup(v))); } catch {}
      const tr = (m, q) => [m[0] * q[0] + m[2] * q[1] + m[4], m[1] * q[0] + m[3] * q[1] + m[5]];
      const cs = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]].map(q => tr(d.ctm, tr(mt, q)));
      if (overlaps([Math.min(...cs.map(c => c[0])), Math.min(...cs.map(c => c[1])), Math.max(...cs.map(c => c[0])), Math.max(...cs.map(c => c[1]))])) flagged = true;
    }
  };
  const ops = walkText(bytes, fontOf); check(ops);
  const remove = new Set(), replace = new Map(); let removed = 0;
  for (const op of ops) {
    if (!op.strings.length) continue;
    const g = op.known ? opGlyphs(op, fontOf(op.fontName)) : null;
    if (!g) { if (covered(op.pos)) flagged = true; continue; }
    const gone = g.map(x => covered(x.center)); if (!gone.some(Boolean)) continue;
    if (gone.every(Boolean)) { remove.add(op.i); removed += g.length; continue; }
    // rewrite: kept runs as hex strings, removed runs as a kerning number of the same width
    const items = []; let pend = 0, k = 0;
    const flush = () => { if (pend) { items.push(fmt(-pend / (op.tfs * op.th) * 1000)); pend = 0; } };
    for (const part of op.parts) {
      if (typeof part === 'number') { flush(); items.push(fmt(part)); continue; }
      if (!(part instanceof Uint8Array)) continue;
      let run = [];
      const endRun = () => { if (run.length) { flush(); items.push(hexOf(run)); run = []; } };
      for (let i = 0; i < part.length;) { const gl = g[k]; if (!gl || gl.part !== part || gl.i !== i) break; const n = gl.part === part ? (g[k + 1] && g[k + 1].part === part ? g[k + 1].i - i : part.length - i) : 1; if (gone[k]) { endRun(); pend += gl.gw; removed++; } else run.push(...part.subarray(i, i + n)); i += n; k++; }
      endRun();
    }
    flush();
    const pre = op.kind === '"' ? `${fmt(op.args[0])} Tw ${fmt(op.args[1])} Tc T* ` : op.kind === "'" ? 'T* ' : '';
    replace.set(op.i, `${pre}[${items.join(' ')}] TJ`);
  }
  if (!remove.size && !replace.size) return { removed: 0, flagged };
  const out = rewriteOps(bytes, ops, remove, replace);
  // the gate: nothing with a known position may still sit under a region
  const again = walkText(out, fontOf);
  for (const op of again) { if (!op.strings.length) continue; const g = op.known ? opGlyphs(op, fontOf(op.fontName)) : null; if (g ? g.some(x => covered(x.center)) : covered(op.pos)) { flagged = true; break; } }
  const ref = doc.context.register(doc.context.flateStream(out));
  page.node.set(PN('Contents'), doc.context.obj([ref]));
  return { removed, flagged };
}

/* Drop every object nothing reaches from the trailer: content streams and annotations that were
   replaced or removed would otherwise be written out unreferenced, text and all. */
export function collectGarbage(doc) {
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

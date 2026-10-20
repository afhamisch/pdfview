// Group text items (pdf.js text content, or OCR words shaped like it) into lines and blocks, and
// turn a block into the text, alignment and line spacing of an editable text object.
// Everything is measured along the text direction u and its normal n, so rotated text works too.

const norm = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

/* items: [{ str, transform, width, height, fontName }], styles: { [fontName]: { ascent, descent } } */
export function measureItems(items, styles) {
  return items.map((it, idx) => {
    const t = it.transform || [1, 0, 0, 1, 0, 0], u = norm([t[0], t[1]]), n = [-u[1], u[0]], size = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 1;
    const P = [t[4], t[5]], s0 = dot(P, u), b = dot(P, n), st = (styles && styles[it.fontName]) || {};
    return { idx, str: it.str || '', fake: !(it.height > 0) || !it.str.trim(), u, n, size, s0, s1: s0 + (it.width || 0), b, asc: st.ascent || 0.9, desc: Math.abs(st.descent || 0.22), fontName: it.fontName };
  });
}

/* Phase one: sets of item indices that read as one block. Lines are items on one baseline; a line
   splits into segments at wide gaps (table cells); segments stack into blocks when they overlap
   horizontally, sit close under each other and use a similar size. */
export function groupBlocks(ms) {
  const real = ms.filter(m => !m.fake || m.str.includes(' '));
  const lines = [];
  for (const m of real.slice().sort((a, b) => b.b - a.b || a.s0 - b.s0)) {
    let ln = lines.find(l => dot(l.u, m.u) > 0.995 && Math.abs(l.b - m.b) < 0.3 * Math.max(l.size, m.size));
    if (!ln) { ln = { u: m.u, n: m.n, b: m.b, size: m.size, items: [] }; lines.push(ln); }
    ln.items.push(m); ln.size = Math.max(ln.size, m.fake ? 0 : m.size);
  }
  const segs = [];
  for (const ln of lines) {
    ln.items.sort((a, b) => a.s0 - b.s0);
    let cur = null, last = null;
    for (const m of ln.items) {
      if (m.fake && !cur) continue;
      if (cur && last && m.s0 - last.s1 > 1.2 * ln.size) { cur = null; }
      if (!cur) { if (m.fake) continue; cur = { u: ln.u, n: ln.n, b: ln.b, size: ln.size, items: [], s0: m.s0, s1: m.s1 }; segs.push(cur); }
      cur.items.push(m); cur.s1 = Math.max(cur.s1, m.s1); last = m;
    }
  }
  for (const sg of segs) { while (sg.items.length && sg.items[sg.items.length - 1].fake) sg.items.pop(); sg.s1 = Math.max(...sg.items.map(m => m.s1)); sg.size = Math.max(...sg.items.map(m => m.fake ? 0 : m.size)); }
  const blocks = [];
  for (const sg of segs.filter(s => s.items.length)) {
    let best = null;
    for (const bl of blocks) {
      const lastLine = bl.segs[bl.segs.length - 1];
      if (dot(lastLine.u, sg.u) < 0.995) continue;
      const gap = lastLine.b - sg.b, ratio = Math.max(lastLine.size, sg.size) / Math.max(0.1, Math.min(lastLine.size, sg.size));
      const overlap = Math.min(bl.s1, sg.s1) - Math.max(bl.s0, sg.s0);
      if (gap > 0.2 * sg.size && gap < 1.7 * Math.max(lastLine.size, sg.size) && ratio < 1.2 && overlap > -0.5 * sg.size) { if (!best || gap < best.gap) best = { bl, gap }; }
    }
    if (best) { best.bl.segs.push(sg); best.bl.s0 = Math.min(best.bl.s0, sg.s0); best.bl.s1 = Math.max(best.bl.s1, sg.s1); }
    else blocks.push({ segs: [sg], s0: sg.s0, s1: sg.s1 });
  }
  return blocks.map(bl => bl.segs.flatMap(sg => sg.items.map(m => m.idx)));
}

/* Phase two: a finished block from a set of item indices. */
export function finishBlock(ms, idxs) {
  const set = new Set(idxs), items = ms.filter(m => set.has(m.idx) && (!m.fake || m.str.includes(' ')));
  if (!items.length) return null;
  const u = items.find(m => !m.fake)?.u || items[0].u, n = [-u[1], u[0]];
  const lines = [];
  for (const m of items.slice().sort((a, b) => b.b - a.b || a.s0 - b.s0)) {
    let ln = lines.find(l => Math.abs(l.b - m.b) < 0.3 * Math.max(l.size, m.size));
    if (!ln) { ln = { b: m.b, size: m.fake ? 0 : m.size, items: [], asc: m.asc, desc: m.desc }; lines.push(ln); }
    ln.items.push(m); if (!m.fake) { ln.size = Math.max(ln.size, m.size); ln.asc = Math.max(ln.asc, m.asc); ln.desc = Math.max(ln.desc, m.desc); }
  }
  for (const ln of lines) {
    ln.items.sort((a, b) => a.s0 - b.s0);
    let text = '', last = null;
    for (const m of ln.items) {
      if (m.fake) { if (text && !text.endsWith(' ')) text += ' '; last = m; continue; }
      if (last && text && !text.endsWith(' ') && !m.str.startsWith(' ') && m.s0 - last.s1 > 0.12 * ln.size) text += ' ';
      text += m.str; last = m;
    }
    ln.text = text.replace(/\s+/g, ' ').trim();
    const solid = ln.items.filter(m => !m.fake);
    ln.s0 = Math.min(...solid.map(m => m.s0)); ln.s1 = Math.max(...solid.map(m => m.s1));
  }
  const good = lines.filter(l => l.text && l.size > 0); if (!good.length) return null;
  const sizes = good.map(l => l.size).sort((a, b) => a - b), size = sizes[sizes.length >> 1];
  const s0 = Math.min(...good.map(l => l.s0)), s1 = Math.max(...good.map(l => l.s1));
  const bTop = good[0].b + good[0].asc * good[0].size, bBot = good[good.length - 1].b - good[good.length - 1].desc * good[good.length - 1].size;
  let lead = 1.2;
  if (good.length > 1) { const d = good.slice(1).map((l, i) => (good[i].b - l.b) / size).sort((a, b) => a - b); lead = Math.max(0.9, Math.min(3, d[d.length >> 1])); }
  // alignment: where the lines sit inside the block
  const W = s1 - s0, tol = Math.max(0.6, 0.06 * size), butLast = good.slice(0, -1);
  const flushL = good.every(l => l.s0 - s0 < tol), flushR = good.every(l => s1 - l.s1 < tol);
  const centered = good.length > 1 && good.every(l => Math.abs((l.s0 - s0) - (s1 - l.s1)) < 2 * tol) && good.some(l => l.s1 - l.s0 < W - 2 * tol);
  let align = 'left';
  if (flushL && butLast.length >= 2 && butLast.every(l => s1 - l.s1 < tol)) align = 'justify';
  else if (!flushL && centered) align = 'center'; else if (!flushL && flushR) align = 'right';
  // wrapped lines join with a space; a line that ends well before the edge keeps its break
  let text = '';
  good.forEach((l, i) => {
    text += l.text; if (i === good.length - 1) return;
    const next = good[i + 1], full = s1 - l.s1 < 2.5 * size && (align !== 'left' || next.s0 - s0 < tol), ends = /[.:;!?]$/.test(l.text) && s1 - l.s1 > 1.0 * size;
    text += full && !ends ? ' ' : '\n';
  });
  const first = good.find(l => l.items.some(m => !m.fake)), fontName = first.items.find(m => !m.fake).fontName;
  const angle = Math.round(Math.atan2(u[1], u[0]) * 180 / Math.PI);
  return { idxs: items.map(m => m.idx), lines: good, u, n, s0, s1, bTop, bBot, b1: good[0].b, size, lead, align, text, fontName, angle, asc: good[0].asc };
}

export function buildBlocks(items, styles, link) {
  const ms = measureItems(items, styles);
  let groups = groupBlocks(ms);
  if (link) { // merge groups that share a content operator (an operator is removed whole)
    const parent = groups.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const owner = new Map();
    groups.forEach((g, gi) => g.forEach(idx => { for (const k of link(idx)) { if (owner.has(k)) parent[find(gi)] = find(owner.get(k)); else owner.set(k, gi); } }));
    const merged = new Map(); groups.forEach((g, gi) => { const r = find(gi); if (!merged.has(r)) merged.set(r, []); merged.get(r).push(...g); });
    groups = [...merged.values()];
  }
  return groups.map(g => finishBlock(ms, g)).filter(Boolean);
}

/* Point in user space -> the block under it, or null. */
export function blockAt(blocks, P) {
  for (const bl of blocks) { const s = dot(P, bl.u), b = dot(P, bl.n); if (s >= bl.s0 - 2 && s <= bl.s1 + 2 && b >= bl.bBot - 1 && b <= bl.bTop + 1) return bl; }
  return null;
}
/* Visual rectangle of a block as our objects store them: top-left corner, size, and angle. */
export function blockRect(bl, padU = 0, padN = 0) {
  const s0 = bl.s0 - padU, top = bl.bTop + padN;
  return { x: bl.u[0] * s0 + bl.n[0] * top, y: bl.u[1] * s0 + bl.n[1] * top, w: bl.s1 - bl.s0 + 2 * padU, h: bl.bTop - bl.bBot + 2 * padN, a: bl.angle };
}

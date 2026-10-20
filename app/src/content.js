// Page content streams: a tokenizer, a walker that tracks the text state so every text-showing
// operator gets a start point in user space, and a rewriter that takes operators out again while
// keeping everything after them where it was. No DOM, no pdf.js: the editor feeds it bytes and a
// font lookup, and tests run it in Node.

const WS = c => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
const DELIM = c => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const REG = c => !WS(c) && !DELIM(c);

/* Tokens: { t: 'num'|'name'|'str'|'op'|'['|']'|'<<'|'>>', v, s, e } with byte offsets [s, e). */
export function* tokenize(b) {
  const n = b.length; let i = 0;
  while (i < n) {
    const c = b[i];
    if (WS(c)) { i++; continue; }
    if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; } // comment
    const s = i;
    if (c === 40) { // literal string
      let depth = 1, out = []; i++;
      while (i < n && depth) {
        const d = b[i];
        if (d === 92) { // backslash
          const e = b[i + 1]; i += 2;
          if (e === 110) out.push(10); else if (e === 114) out.push(13); else if (e === 116) out.push(9); else if (e === 98) out.push(8); else if (e === 102) out.push(12);
          else if (e >= 48 && e <= 55) { let v = e - 48, k = 1; while (k < 3 && b[i] >= 48 && b[i] <= 55) { v = v * 8 + (b[i] - 48); i++; k++; } out.push(v & 255); }
          else if (e === 13) { if (b[i] === 10) i++; } else if (e === 10) {} else out.push(e);
          continue;
        }
        if (d === 40) depth++; else if (d === 41) { depth--; if (!depth) { i++; break; } }
        out.push(d); i++;
      }
      yield { t: 'str', v: Uint8Array.from(out), s, e: i }; continue;
    }
    if (c === 60) {
      if (b[i + 1] === 60) { i += 2; yield { t: '<<', s, e: i }; continue; }
      i++; const hex = []; let cur = -1;
      while (i < n && b[i] !== 62) { const d = b[i++]; let v = -1; if (d >= 48 && d <= 57) v = d - 48; else if (d >= 65 && d <= 70) v = d - 55; else if (d >= 97 && d <= 102) v = d - 87; if (v < 0) continue; if (cur < 0) cur = v; else { hex.push(cur * 16 + v); cur = -1; } }
      if (cur >= 0) hex.push(cur * 16); i++;
      yield { t: 'str', v: Uint8Array.from(hex), s, e: i }; continue;
    }
    if (c === 62) { i += b[i + 1] === 62 ? 2 : 1; yield { t: '>>', s, e: i }; continue; }
    if (c === 91) { i++; yield { t: '[', s, e: i }; continue; }
    if (c === 93) { i++; yield { t: ']', s, e: i }; continue; }
    if (c === 123 || c === 125) { i++; continue; }
    if (c === 47) { // name
      i++; let v = '';
      while (i < n && REG(b[i])) { if (b[i] === 35 && i + 2 < n) { v += String.fromCharCode(parseInt(String.fromCharCode(b[i + 1], b[i + 2]), 16)); i += 3; } else v += String.fromCharCode(b[i++]); }
      yield { t: 'name', v, s, e: i }; continue;
    }
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
      i++; while (i < n && REG(b[i])) i++;
      const txt = latin(b, s, i), v = parseFloat(txt.replace(/^-+/, '-').replace(/(\.\d*)\./, '$1'));
      yield { t: 'num', v: isNaN(v) ? 0 : v, s, e: i }; continue;
    }
    i++; while (i < n && REG(b[i])) i++;
    const op = latin(b, s, i);
    if (op === 'BI') { // inline image: skip the binary body up to EI
      let j = i; while (j < n) { if (b[j] === 73 && b[j + 1] === 68 && WS(b[j + 2]) && (j === 0 || WS(b[j - 1]))) { j += 3; break; } j++; }
      while (j < n) { if (WS(b[j]) && b[j + 1] === 69 && b[j + 2] === 73 && (j + 3 >= n || WS(b[j + 3]) || DELIM(b[j + 3]))) { j += 3; break; } j++; }
      i = j; yield { t: 'op', v: 'BI', s, e: i }; continue;
    }
    yield { t: 'op', v: op, s, e: i };
  }
}
export function latin(b, s, e) { let out = ''; for (let i = s; i < e; i++) out += String.fromCharCode(b[i]); return out; }

const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const ID = [1, 0, 0, 1, 0, 0];
const hex2 = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
const rgbHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);
const cmykHex = (c, m, y, k) => rgbHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));

/* Walk the stream. fontOf(resourceName) returns { adv(bytes) -> { w, n, spaces } | null } or null.
   Returns the text-showing operators in stream order: { i, kind, s, e, bt, pos, dir, size, fontName,
   tfs, th, tc, tw, tr, color, repos, known, adv, args, strings }. */
export function walkText(bytes, fontOf) {
  const ops = []; let stack = [], ctmStack = [], ctm = ID, tm = ID, tlm = ID;
  let tfs = 0, fontName = null, font = null, tc = 0, tw = 0, th = 1, tl = 0, ts = 0, tr = 0, color = '#000000';
  let bt = -1, repos = true, unknown = false, opStart = -1, arrDepth = 0, dictDepth = 0;
  const num = k => { const v = stack[stack.length - k]; return typeof v === 'number' ? v : 0; };
  const advance = parts => { // parts: strings and numbers (a TJ array), returns user-text-space advance or null
    let tx = 0;
    for (const part of parts) {
      if (typeof part === 'number') { tx -= part / 1000 * tfs * th; continue; }
      if (!(part instanceof Uint8Array)) continue;
      const a = font && font.adv ? font.adv(part) : null; if (!a) return null;
      tx += (a.w * tfs + a.n * tc + a.spaces * tw) * th;
    }
    return tx;
  };
  const show = (kind, parts, tok, args) => {
    const trm = mul(mul([tfs * th, 0, 0, tfs, 0, ts], tm), ctm);
    const len = Math.hypot(trm[0], trm[1]) || 1;
    const adv = advance(parts);
    ops.push({ i: ops.length, kind, s: opStart >= 0 ? opStart : tok.s, e: tok.e, bt, pos: [trm[4], trm[5]], dir: [trm[0] / len, trm[1] / len], size: Math.hypot(trm[2], trm[3]), fontName, tfs, th, tc, tw, tr, color, repos, known: !unknown, adv, args, strings: parts.filter(p => p instanceof Uint8Array) });
    repos = false;
    if (adv == null) unknown = true; else tm = mul([1, 0, 0, 1, adv, 0], tm);
  };
  const td = (x, y) => { tlm = mul([1, 0, 0, 1, x, y], tlm); tm = tlm; repos = true; unknown = false; };
  for (const tok of tokenize(bytes)) {
    if (tok.t !== 'op') {
      if (opStart < 0) opStart = tok.s;
      if (tok.t === '[') { stack.push(tok); arrDepth++; }
      else if (tok.t === ']') { const arr = []; while (stack.length) { const v = stack.pop(); if (v && v.t === '[') break; arr.unshift(v); } stack.push(arr); arrDepth--; }
      else if (tok.t === '<<') { stack.push(tok); dictDepth++; }
      else if (tok.t === '>>') { while (stack.length) { const v = stack.pop(); if (v && v.t === '<<') break; } stack.push({ dict: true }); dictDepth--; }
      else stack.push(tok.t === 'name' ? { name: tok.v } : tok.v);
      continue;
    }
    const op = tok.v;
    switch (op) {
      case 'q': ctmStack.push(ctm); break;
      case 'Q': if (ctmStack.length) ctm = ctmStack.pop(); break;
      case 'cm': if (stack.length >= 6) ctm = mul([num(6), num(5), num(4), num(3), num(2), num(1)], ctm); break;
      case 'BT': tm = tlm = ID; bt++; repos = true; unknown = false; break;
      case 'Tf': { const nm = stack[stack.length - 2]; fontName = nm && nm.name != null ? nm.name : null; tfs = num(1); font = fontName != null && fontOf ? fontOf(fontName) : null; break; }
      case 'Td': td(num(2), num(1)); break;
      case 'TD': tl = -num(1); td(num(2), num(1)); break;
      case 'Tm': if (stack.length >= 6) { tm = tlm = [num(6), num(5), num(4), num(3), num(2), num(1)]; repos = true; unknown = false; } break;
      case 'T*': td(0, -tl); break;
      case 'TL': tl = num(1); break;
      case 'Tc': tc = num(1); break;
      case 'Tw': tw = num(1); break;
      case 'Tz': th = num(1) / 100; break;
      case 'Ts': ts = num(1); break;
      case 'Tr': tr = num(1); break;
      case 'g': color = rgbHex(num(1), num(1), num(1)); break;
      case 'rg': color = rgbHex(num(3), num(2), num(1)); break;
      case 'k': color = cmykHex(num(4), num(3), num(2), num(1)); break;
      case 'sc': case 'scn': { const nums = stack.filter(v => typeof v === 'number'); if (nums.length === 1) color = rgbHex(nums[0], nums[0], nums[0]); else if (nums.length === 3) color = rgbHex(...nums); else if (nums.length === 4) color = cmykHex(...nums); break; }
      case 'Tj': { const s = stack[stack.length - 1]; show('Tj', s instanceof Uint8Array ? [s] : [], tok); break; }
      case 'TJ': { const a = stack[stack.length - 1]; show('TJ', Array.isArray(a) ? a : [], tok); break; }
      case "'": { td(0, -tl); const s = stack[stack.length - 1]; show("'", s instanceof Uint8Array ? [s] : [], tok); break; }
      case '"': { tw = num(3); tc = num(2); td(0, -tl); const s = stack[stack.length - 1]; show('"', s instanceof Uint8Array ? [s] : [], tok, [num(3), num(2)]); break; }
    }
    stack = []; opStart = -1;
  }
  return ops;
}

/* Remove the given operators (by index). Everything that followed them stays in place: when a kept
   operator on the same line relied on the removed text's advance, a kerning-only TJ of the same width
   takes its place; if the width cannot be known the text stays but is made invisible. */
export function removeOps(bytes, ops, remove) {
  const parts = []; let at = 0; const f = v => (Math.round(v * 100) / 100).toString();
  for (const op of ops) {
    if (!remove.has(op.i)) continue;
    let needComp = false;
    for (let j = op.i + 1; j < ops.length && ops[j].bt === op.bt; j++) { if (ops[j].repos) break; if (!remove.has(ops[j].i)) { needComp = true; break; } }
    const out = [];
    if (op.kind === '"') out.push(`${f(op.args[0])} Tw ${f(op.args[1])} Tc T*`); else if (op.kind === "'") out.push('T*');
    if (needComp) {
      if (op.adv != null && op.tfs) out.push(`[${f(-op.adv / (op.tfs * op.th) * 1000)}] TJ`);
      else { const orig = latin(bytes, op.s, op.e).replace(/^.*?(?=\(|<|\[)/s, ''); out.push(`3 Tr ${op.kind === '"' || op.kind === "'" ? orig.replace(/['"]\s*$/, 'Tj') : orig} ${f(op.tr)} Tr`); }
    }
    parts.push(bytes.subarray(at, op.s), new TextEncoder().encode(out.join(' ') + (out.length ? '\n' : ''))); at = op.e;
  }
  parts.push(bytes.subarray(at));
  const n = parts.reduce((a, p) => a + p.length, 0), res = new Uint8Array(n); let o = 0;
  for (const p of parts) { res.set(p, o); o += p.length; }
  return res;
}

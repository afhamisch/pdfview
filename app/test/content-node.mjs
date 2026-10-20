// Unit checks for content.js: removing a text operator must leave what follows it on the line
// exactly where it was, through the kerning-only TJ (known widths) or the invisible-text fallback.
import { walkText, removeOps, latin } from '../src/content.js';
const enc = s => new TextEncoder().encode(s);
const fixed = { adv: b => ({ w: 0.5 * b.length, n: b.length, spaces: [...b].filter(c => c === 32).length }) };
const unknown = { adv: () => null };
let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) fails++; };
const near = (a, b) => Math.abs(a - b) < 0.01;
function run(src, fontOf, removeIdx, label) {
  const bytes = enc(src), ops = walkText(bytes, fontOf);
  const out = removeOps(bytes, ops, new Set(removeIdx));
  const ops2 = walkText(out, fontOf);
  const kept = ops.filter(o => !removeIdx.includes(o.i)), kept2 = ops2.filter(o => o.strings.length && o.tr === 0);
  const same = kept.length === kept2.length && kept.every((o, k) => near(o.pos[0], kept2[k].pos[0]) && near(o.pos[1], kept2[k].pos[1]));
  check(label, same, JSON.stringify({ before: kept.map(o => o.pos.map(v => +v.toFixed(2))), after: kept2.map(o => o.pos.map(v => +v.toFixed(2))), out: latin(out, 0, out.length) }));
  return { out, ops2 };
}
// 1. two Tj on one line, first removed: the second must not slide left
run('BT /F1 12 Tf 72 700 Td (Hello ) Tj (World) Tj ET', () => fixed, [0], 'kerning TJ keeps the next word in place');
// 2. same with character and word spacing and horizontal scaling in play
run('BT /F1 10 Tf 0.5 Tc 2 Tw 80 Tz 72 700 Td (a b) Tj (c) Tj ET', () => fixed, [0], 'Tc, Tw and Tz folded into the compensation');
// 3. a TJ array with kerning numbers removed before a kept Tj
run('BT /F1 12 Tf 72 700 Td [(Hel) -500 (lo)] TJ (World) Tj ET', () => fixed, [0], 'TJ numbers counted in the advance');
// 4. unknown widths: the text stays but goes invisible, position preserved by the glyphs themselves
{ const { out, ops2 } = run('BT /F1 12 Tf 72 700 Td (Hello ) Tj (World) Tj ET', () => unknown, [0], 'unknown widths fall back to invisible text');
  check('fallback wraps in 3 Tr', /3 Tr \(Hello \) Tj 0 Tr/.test(latin(out, 0, out.length)), latin(out, 0, out.length)); check('fallback op is invisible', ops2[0].tr === 3); }
// 5. the quote operators keep their line move and spacing settings
run("BT /F1 12 Tf 14 TL 72 700 Td (one) Tj (two) ' (three) Tj ET", () => fixed, [1], "' removed: T* kept");
run('BT /F1 12 Tf 14 TL 72 700 Td (one) Tj 2 0.5 (two) " (three) Tj ET', () => fixed, [1], '" removed: Tw, Tc and T* kept');
// 6. a removed operator followed by a repositioning needs no compensation at all
{ const bytes = enc('BT /F1 12 Tf 72 700 Td (Hello) Tj 0 -14 Td (World) Tj ET'); const ops = walkText(bytes, () => fixed); const out = latin(removeOps(bytes, ops, new Set([0])), 0, 1e6); check('no TJ emitted when a Td follows', !/TJ/.test(out) && /\(World\) Tj/.test(out), out); }
// 7. removing both operators on a line leaves nothing behind
{ const bytes = enc('BT /F1 12 Tf 72 700 Td (Hello ) Tj (World) Tj ET'); const ops = walkText(bytes, () => fixed); const out = latin(removeOps(bytes, ops, new Set([0, 1])), 0, 1e6); check('whole line removed cleanly', !/Hello|World|TJ/.test(out), out); }
// 8. tokenizer corner cases: nested parens, escapes, hex, names with #, negative numbers, inline images
{ const bytes = enc('q BI /W 2 /H 2 /CS /G /BPC 8 ID \x00\x01\x02\x03 EI Q BT /F#31 -12.5 Tf -72 -700.25 Td (a(b)c\\)d\\n) Tj <48656C6C6F> Tj ET'); const ops = walkText(bytes, () => fixed);
  check('inline image skipped and strings parsed', ops.length === 2 && latin(ops[0].strings[0], 0, 99) === 'a(b)c)d\n' && latin(ops[1].strings[0], 0, 99) === 'Hello', JSON.stringify(ops.map(o => latin(o.strings[0], 0, 99))));
  check('negative operands keep their sign', near(ops[0].pos[0], -72) && near(ops[0].pos[1], -700.25) && ops[0].tfs === -12.5, ops[0].pos.join(',')); }
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);

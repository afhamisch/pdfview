// Copies the pdf.js resources the worker fetches at run time (JBIG2 and JPX decoders, ICC profile,
// standard fonts, CMaps) into public/pdfjs so they ship with the built app. Runs before dev and build.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'node_modules', 'pdfjs-dist'), dst = join(here, '..', 'public', 'pdfjs');
for (const d of ['wasm', 'standard_fonts', 'cmaps', 'iccs']) {
  if (!existsSync(join(src, d))) { console.warn('missing', d); continue; }
  mkdirSync(join(dst, d), { recursive: true });
  cpSync(join(src, d), join(dst, d), { recursive: true, filter: p => !/LICENSE/.test(p) });
}
// OCR engine (tesseract.js): worker, WebAssembly cores and English data, served from /ocr
const ocr = join(here, '..', 'public', 'ocr'); mkdirSync(ocr, { recursive: true });
const nm = join(here, '..', '..', 'node_modules');
for (const [from, to] of [
  [join(nm, 'tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(nm, 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(nm, 'tesseract.js-core', 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  [join(nm, 'tesseract.js-core', 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [join(nm, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz']
]) { if (existsSync(from)) cpSync(from, join(ocr, to)); else console.warn('missing OCR asset', from); }
// Fonts: open fonts from npm plus anything dropped into app/fonts; public/fonts/fonts.json lists them.
import { readdirSync, writeFileSync, statSync } from 'node:fs';
const fontsDir = join(here, '..', 'public', 'fonts'); mkdirSync(fontsDir, { recursive: true });
const families = [];
const addFamily = (id, label, files) => { const out = {}; for (const [v, from] of Object.entries(files)) { if (!from || !existsSync(from)) continue; const to = `${id}-${v}${from.slice(from.lastIndexOf('.'))}`; cpSync(from, join(fontsDir, to)); out[v] = to; } if (out.regular) families.push({ id, label, files: out }); };
const fs = (pkg, name) => ['regular', 'bold', 'italic', 'bolditalic'].reduce((o, v) => { const [w, st] = { regular: ['400', 'normal'], bold: ['700', 'normal'], italic: ['400', 'italic'], bolditalic: ['700', 'italic'] }[v]; o[v] = join(nm, '@fontsource', pkg, 'files', `${name}-latin-${w}-${st}.woff`); return o; }, {});
addFamily('tinos', 'Tinos (Times New Roman look)', fs('tinos', 'tinos'));
addFamily('arimo', 'Arimo (Arial look)', fs('arimo', 'arimo'));
addFamily('cousine', 'Cousine (Courier New look)', fs('cousine', 'cousine'));
addFamily('ebgaramond', 'EB Garamond', fs('eb-garamond', 'eb-garamond'));
addFamily('crimson', 'Crimson Pro', fs('crimson-pro', 'crimson-pro'));
addFamily('baskerville', 'Libre Baskerville', fs('libre-baskerville', 'libre-baskerville'));
const dv = f => join(nm, 'dejavu-fonts-ttf', 'ttf', f);
addFamily('dejavuserif', 'DejaVu Serif', { regular: dv('DejaVuSerif.ttf'), bold: dv('DejaVuSerif-Bold.ttf'), italic: dv('DejaVuSerif-Italic.ttf'), bolditalic: dv('DejaVuSerif-BoldItalic.ttf') });
addFamily('dejavusans', 'DejaVu Sans', { regular: dv('DejaVuSans.ttf'), bold: dv('DejaVuSans-Bold.ttf'), italic: dv('DejaVuSans-Oblique.ttf'), bolditalic: dv('DejaVuSans-BoldOblique.ttf') });
// user-supplied fonts in app/fonts, grouped by the file name before the variant word
const userDir = join(here, '..', 'fonts'); const groups = {};
if (existsSync(userDir)) for (const f of readdirSync(userDir)) {
  if (!/\.(ttf|otf|woff)$/i.test(f) || !statSync(join(userDir, f)).isFile()) continue;
  const base = f.replace(/\.(ttf|otf|woff)$/i, ''); const m = /[-_ ]?(bold ?italic|bold ?oblique|bolditalic|bold|italic|oblique|regular)$/i.exec(base);
  const fam = m ? base.slice(0, m.index) : base, v = m ? m[1].toLowerCase().replace(/[ _-]/g, '').replace('oblique', 'italic') : 'regular';
  (groups[fam] ||= {})[v === 'regular' ? 'regular' : v] = join(userDir, f);
}
for (const [fam, files] of Object.entries(groups)) addFamily('user-' + fam.toLowerCase().replace(/[^a-z0-9]+/g, '-'), fam.replace(/[-_]+/g, ' '), files);
writeFileSync(join(fontsDir, 'fonts.json'), JSON.stringify(families));
console.log(`pdf.js and OCR resources copied to public/pdfjs and public/ocr; ${families.length} font families in public/fonts`);

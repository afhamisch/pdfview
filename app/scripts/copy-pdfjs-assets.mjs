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
console.log('pdf.js and OCR resources copied to public/pdfjs and public/ocr');

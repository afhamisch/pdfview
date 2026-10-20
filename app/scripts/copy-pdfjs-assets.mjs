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
console.log('pdf.js resources copied to public/pdfjs');

// Extra fonts: listed in /fonts/fonts.json at build time, registered for on-screen use, and embedded
// (subset) into saved PDFs. Not available in the single offline file.
import fontkit from '@pdf-lib/fontkit';
import { FONTS } from './textstyle.js';

let manifest = [], loaded = false;
const base = () => new URL('fonts/', document.baseURI).href;
export async function initFonts() {
  if (__OFFLINE__) return;
  try { manifest = await (await fetch(base() + 'fonts.json')).json(); } catch { manifest = []; }
  for (const fam of manifest) {
    const family = 'PDFView ' + fam.id;
    FONTS[fam.id] = { label: fam.label, css: `"${family}", serif`, custom: fam };
    for (const [v, file] of Object.entries(fam.files)) {
      const face = new FontFace(family, `url(${base()}${file})`, { weight: v.startsWith('bold') ? '700' : '400', style: v.endsWith('italic') ? 'italic' : 'normal' });
      face.load().then(f => document.fonts.add(f)).catch(e => console.warn('font', file, e));
    }
  }
  loaded = true;
}
export const customFont = id => FONTS[id]?.custom || null;
const bytesCache = new Map();
// Embed the right variant for a text object; falls back to the regular file, or null when the family is unknown.
export async function embedCustom(doc, o) {
  const fam = customFont(o.font); if (!fam) return null;
  const v = o.bold && o.italic ? 'bolditalic' : o.bold ? 'bold' : o.italic ? 'italic' : 'regular';
  const file = fam.files[v] || fam.files.regular; if (!file) return null;
  if (!bytesCache.has(file)) bytesCache.set(file, fetch(base() + file).then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(file))));
  const bytes = await bytesCache.get(file);
  if (!doc._fontkit) { doc.registerFontkit(fontkit); doc._fontkit = true; }
  return doc.embedFont(bytes, { subset: true });
}

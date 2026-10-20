// Offline single-file build: the decoders and standard fonts are inlined as data URLs so a file opened
// from disk can still render JBIG2 and JPX scans and non-embedded standard fonts. CMaps are left out
// to keep the file small; PDFs that need them (mostly CJK text) render their text with fallbacks.
const wasm = import.meta.glob('/../node_modules/pdfjs-dist/wasm/*.wasm', { query: '?url', import: 'default', eager: true });
const fonts = import.meta.glob('/../node_modules/pdfjs-dist/standard_fonts/*', { query: '?url', import: 'default', eager: true });
const byName = m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k.split('/').pop(), v]));
export const inline = { wasmUrl: byName(wasm), standardFontDataUrl: byName(fonts), cMapUrl: {} };

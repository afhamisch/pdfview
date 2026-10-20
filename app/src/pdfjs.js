// pdf.js entry: the parser always runs in a real Web Worker. In the offline single-file build the
// worker code is inlined as a blob; otherwise Vite emits it as its own chunk. The worker also needs
// resources at run time (JBIG2 and JPX decoders for scans, ICC profile, standard fonts, CMaps). When
// served they come from /pdfjs/; offline they are handed over inline through a custom factory.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const DIRS = { wasmUrl: 'wasm/', standardFontDataUrl: 'standard_fonts/', cMapUrl: 'cmaps/', iccUrl: 'iccs/' };
let ready, inline = null;

// Offline only: pdf.js asks this (on the main thread) for every resource the worker needs.
class InlineResources {
  async fetch({ kind, filename }) {
    const url = inline?.[kind]?.[filename];
    if (!url) throw new Error(`No ${kind} resource for ${filename}`);
    const r = await fetch(url); if (!r.ok) throw new Error(`Could not load ${filename}`);
    return new Uint8Array(await r.arrayBuffer());
  }
}
export function docOptions(extra = {}) {
  const o = { isEvalSupported: false, cMapPacked: true };
  if (__OFFLINE__) o.BinaryDataFactory = InlineResources;
  else { const base = new URL('pdfjs/', document.baseURI).href; for (const [k, d] of Object.entries(DIRS)) o[k] = base + d; }
  return Object.assign(o, extra);
}
export async function pdfjs() {
  if (!ready) {
    ready = (async () => {
      if (__OFFLINE__) {
        const { default: PdfWorker } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline');
        pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
        inline = (await import('./resources-offline.js')).inline;
      } else {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;
      }
      return pdfjsLib;
    })();
  }
  return ready;
}
export { pdfjsLib };

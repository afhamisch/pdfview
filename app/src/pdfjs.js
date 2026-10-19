// pdf.js entry: the parser always runs in a real Web Worker. In the offline single-file build the
// worker code is inlined as a blob; otherwise Vite emits it as its own chunk.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

let ready;
export async function pdfjs() {
  if (!ready) {
    ready = (async () => {
      if (__OFFLINE__) {
        const { default: PdfWorker } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline');
        pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
      } else {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;
      }
      return pdfjsLib;
    })();
  }
  return ready;
}
export { pdfjsLib };

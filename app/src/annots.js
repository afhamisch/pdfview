// Marks already in the file (highlights, drawings, notes and shapes made in another program). pdf.js
// paints them into the page and lays a section over each; this finds the section under a click or an
// eraser stroke and takes the annotation out of the page in the pdf-lib copy, with an undo record on
// the lift stack so Ctrl+Z puts it back. Form fields, links and popups are never touched.
import { S } from './state.js';
import { libDoc, reloadMain } from './document.js';
import { PDFName, PDFDict, PDFRef } from 'pdf-lib';

const PN = k => PDFName.of(k);
const SKIP = /widget|linkAnnotation|popupAnnotation/i;
const LABELS = { highlight: 'Highlight', underline: 'Underline', strikeout: 'Strike-out', squiggly: 'Squiggly underline', ink: 'Drawing', freeText: 'Text box', text: 'Note', square: 'Rectangle', circle: 'Circle', line: 'Line', polygon: 'Shape', polyline: 'Shape', stamp: 'Stamp', fileAttachment: 'Attachment', caret: 'Caret' };

/* The removable mark section an event target sits in, or null. */
export function markSection(target) {
  const sec = target && target.closest ? target.closest('.annotationLayer section[data-annotation-id]') : null;
  return sec && !SKIP.test(sec.className) ? sec : null;
}
export function markLabel(sec) { const m = /(\w+)Annotation/.exec(sec.className || ''); return (m && LABELS[m[1]]) || 'Mark'; }
export function parseId(id) { const m = /^(\d+)R(\d*)$/.exec(id || ''); return m ? PDFRef.of(+m[1], m[2] ? +m[2] : 0) : null; }
/* Mark sections of a page whose box holds any of the given client points (an eraser stroke). */
export function marksAt(p, clientPts) {
  const out = [];
  if (!p.al) return out;
  for (const sec of p.al.querySelectorAll('section[data-annotation-id]')) {
    if (SKIP.test(sec.className)) continue;
    const r = sec.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    if (clientPts.some(([x, y]) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) out.push(sec);
  }
  return out;
}
/* Take annotations (pdf.js ids like "12R") off a page of the main document and reload it. Replies and
   popups that hang off a removed annotation go with it. Returns how many were removed. */
export async function deleteMarks(p, ids) {
  if (p.src !== 0) throw new Error('inserted');
  const refs = ids.map(parseId).filter(Boolean); if (!refs.length) return 0;
  const lib = await libDoc(), ctx = lib.context, node = lib.getPage(p.si).node;
  const prev = node.get(PN('Annots')), arr = node.Annots(); if (!arr) return 0;
  const same = (a, b) => a instanceof PDFRef && b instanceof PDFRef && a.objectNumber === b.objectNumber && a.generationNumber === b.generationNumber;
  const gone = r => refs.some(x => same(x, r));
  const keep = []; let n = 0;
  for (const item of arr.asArray()) {
    let drop = gone(item);
    if (!drop && item instanceof PDFRef) { const d = ctx.lookup(item); if (d instanceof PDFDict && (gone(d.get(PN('Parent'))) || gone(d.get(PN('IRT'))))) drop = true; }
    if (drop) n++; else keep.push(item);
  }
  if (!n) return 0;
  node.set(PN('Annots'), ctx.obj(keep));
  S.lifts.push({ kind: 'annots', pageIndex: p.si, prev });
  await reloadMain(await lib.save({ updateFieldAppearances: false }));
  S.meta.comments = null; // the Notes list reads the file again
  return n;
}

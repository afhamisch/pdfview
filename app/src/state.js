// Central state and a tiny event bus. Everything that touches the document goes through S.
export const S = {
  mode: 'desk',          // 'desk' (viewer + editor) or 'sign' (signer page)
  doc: null, bytes: null, name: '', sample: false,
  sources: new Map(),    // sourceId -> { id, name, bytes, doc }
  pages: [], reg: new Map(),
  scale: 1, fit: 'width', // 'width' | 'page' | null
  tool: 'select', objects: [], sel: null, editing: null, undo: [], redo: [], dirty: false,
  sig: null, tsize: 11, tcolor: '#111111', stamp: '', ink: { mode: 'marker', width: 8, markerColor: '#ffd400', penColor: '#111111', eraseWidth: 10 }, shape: { kind: 'arrow', width: 2, color: '#b3261e' }, snap: null, textStyle: { font: 'helv', bold: false, italic: false, underline: false, align: 'left', list: 'none' },
  org: false, osel: new Set(), anchor: null, orgReturn: null,
  lifts: [], lib: null, hover: null, lifting: false, // text lifted off the page for editing (see textedit.js): undo records and the cached pdf-lib document
  bates: null,           // { prefix, start, pad, corner, size } or null
  meta: {},              // misc: outline, title
  saving: false,         // a save or print is building the file: tabs stay put until it is done
  file: null,            // where the active document came from: { kind: 'path', path } (desktop) or { kind: 'handle', handle } (Chrome), else null
  author: (() => { try { return localStorage.getItem('pdfview.author') || ''; } catch { return ''; } })(), noteColor: '#ffd400',
  tabs: [], tab: null    // open documents (see tabs.js); the fields in DOC_KEYS belong to the active tab
};
// Everything that belongs to one open document rather than to the app.
export const DOC_KEYS = ['doc', 'bytes', 'name', 'sample', 'sources', 'pages', 'reg', 'scale', 'fit', 'objects', 'sel', 'editing', 'undo', 'dirty', 'bates', 'meta', 'formDirty', 'lifts', 'lib', 'hover', 'lifting', 'org', 'osel', 'anchor', 'orgReturn', 'snap', 'file', 'redo'];
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, e => fn(e.detail));
let uid = 1, puid = 1, srcSeq = 1;
export const nextUid = () => uid++, nextPuid = () => puid++, nextSrc = () => srcSeq++;
export const PG = u => S.reg.get(u);
// OCR words that an edited block replaced (see liftBlock in editor.js): they stay out of the selectable
// layer, the search index and the saved file while the object that replaced them exists.
export function coveredWords(p) { const out = new Set(); for (const o of S.objects) if (o.page === p.uid && o.ocrIdx) for (const i of o.ocrIdx) out.add(i); return out; }

// Central state and a tiny event bus. Everything that touches the document goes through S.
export const S = {
  mode: 'desk',          // 'desk' (viewer + editor) or 'sign' (signer page)
  doc: null, bytes: null, name: '', sample: false,
  sources: new Map(),    // sourceId -> { id, name, bytes, doc }
  pages: [], reg: new Map(),
  scale: 1, fit: 'width', // 'width' | 'page' | null
  tool: 'select', objects: [], sel: null, editing: null, undo: [], dirty: false,
  sig: null, tsize: 11, tcolor: '#111111',
  org: false, osel: new Set(), anchor: null, orgReturn: null,
  bates: null,           // { prefix, start, pad, corner, size } or null
  meta: {}               // misc: outline, title
};
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, e => fn(e.detail));
let uid = 1, puid = 1, srcSeq = 1;
export const nextUid = () => uid++, nextPuid = () => puid++, nextSrc = () => srcSeq++;
export const PG = u => S.reg.get(u);

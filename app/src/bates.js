// Bates numbering: a running number stamped on every page of the saved copy, previewed on screen.
import { S, on, emit } from './state.js';
import { rotOf, place } from './geometry.js';
import { $, el, toast } from './ui.js';
import { pushUndo, markDirty, renderAllObjs } from './editor.js';

export const batesLabel = (b, idx) => (b.prefix || '') + String((b.start || 0) + idx).padStart(b.pad || 1, '0');
const MARGIN = 30;
let meas;
export function textWidth(str, size) {
  if (!meas) meas = document.createElement('canvas').getContext('2d');
  meas.font = `${size}px Helvetica, Arial, sans-serif`; return meas.measureText(str).width;
}
// Visual placement on a page: returns { x, y, a, w, h } in user space for the label box.
export function batesBox(p, idx, b, widthFn = textWidth) {
  const R = rotOf(p), v1 = p.proxy.getViewport({ scale: 1, rotation: R }), W = v1.width, H = v1.height;
  const label = batesLabel(b, idx), size = b.size || 10, tw = widthFn(label, size), th = size;
  let u, v;
  const c = b.corner || 'br';
  u = c.endsWith('l') ? MARGIN : c.endsWith('c') ? (W - tw) / 2 : W - MARGIN - tw;
  v = c.startsWith('t') ? MARGIN : H - MARGIN - th;
  const [x, y] = v1.convertToPdfPoint(u, v);
  return { x, y, a: R, w: tw, h: th, label, size };
}
function preview(p) {
  if (!S.bates || !p.ol) return;
  const idx = S.pages.indexOf(p); if (idx < 0) return;
  const bx = batesBox(p, idx, S.bates);
  const d = el('div', { class: 'obj obj-bates', text: bx.label, style: { fontSize: bx.size * S.scale + 'px', lineHeight: '1' } });
  place(d, p, bx); p.ol.append(d);
}
function openBates() {
  const b = S.bates || { prefix: '', start: 1, pad: 6, corner: 'br', size: 10 };
  $('#batesPrefix').value = b.prefix; $('#batesStart').value = b.start; $('#batesPad').value = b.pad; $('#batesCorner').value = b.corner; $('#batesSize').value = b.size;
  $('#batesRemove').hidden = !S.bates; updatePreview(); $('#batesModal').hidden = false; $('#batesPrefix').focus();
}
function read() { return { prefix: $('#batesPrefix').value.trim(), start: Math.max(0, parseInt($('#batesStart').value, 10) || 0), pad: Math.min(10, Math.max(1, parseInt($('#batesPad').value, 10) || 1)), corner: $('#batesCorner').value, size: +$('#batesSize').value || 10 }; }
function updatePreview() { const b = read(), n = S.pages.length; $('#batesPreview').textContent = `${batesLabel(b, 0)} through ${batesLabel(b, Math.max(0, n - 1))} on ${n} pages`; }
function apply() { pushUndo(); S.bates = read(); markDirty(); $('#batesModal').hidden = true; renderAllObjs(); toast('Bates numbers will be stamped when you save.'); }
function remove() { pushUndo(); S.bates = null; markDirty(); $('#batesModal').hidden = true; renderAllObjs(); }
export function init() {
  $('#batesBtn').addEventListener('click', openBates);
  ['#batesPrefix', '#batesStart', '#batesPad', '#batesCorner', '#batesSize'].forEach(s => $(s).addEventListener('input', updatePreview));
  $('#batesApply').addEventListener('click', apply); $('#batesRemove').addEventListener('click', remove);
  $('#batesCancel').addEventListener('click', () => $('#batesModal').hidden = true);
  $('#batesModal').addEventListener('pointerdown', e => { if (e.target.id === 'batesModal') $('#batesModal').hidden = true; });
  $('#batesModal').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); apply(); } if (e.key === 'Escape') { e.stopPropagation(); $('#batesModal').hidden = true; } });
  on('objs:rendered', preview);
}

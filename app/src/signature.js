// Signature capture: draw on a pad or type a name. Returns { url (PNG data URL), ar (height/width) }.
import { $, $$, toast } from './ui.js';
const sigC = () => $('#sigCanvas');
let sigInk = false, sigTab = 'draw', resolver = null;
function sizeSig() { const c = sigC(), r = c.getBoundingClientRect(); c.width = Math.max(10, r.width * 2); c.height = Math.max(10, r.height * 2); sigInk = false; }
export function openSig(title) {
  return new Promise(res => {
    resolver = res; $('#sigTitle').textContent = title || 'Create your signature';
    $('#sigModal').hidden = false; sizeSig(); setSigTab(sigTab); if (sigTab === 'type') $('#sigName').focus();
  });
}
function finish(v) { $('#sigModal').hidden = true; const r = resolver; resolver = null; if (r) r(v); }
function setSigTab(t) { sigTab = t; $$('[data-sigtab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sigtab === t))); $('#sigDraw').hidden = t !== 'draw'; $('#sigType').hidden = t !== 'type'; }
export function trim(cv) {
  const g = cv.getContext('2d'), { width: W, height: H } = cv, d = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = 8; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1; o.getContext('2d').drawImage(cv, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return { url: o.toDataURL('image/png'), ar: o.height / o.width };
}
export async function typedSignature(name) {
  try { await document.fonts.load('96px "Mrs Saint Delafield"'); } catch {}
  const cv = document.createElement('canvas'), g = cv.getContext('2d'); g.font = '96px "Mrs Saint Delafield", "Brush Script MT", cursive';
  const w = Math.ceil(g.measureText(name).width) + 80; cv.width = w; cv.height = 200;
  const g2 = cv.getContext('2d'); g2.font = '96px "Mrs Saint Delafield", "Brush Script MT", cursive'; g2.fillStyle = '#1a2a5c'; g2.textBaseline = 'middle'; g2.fillText(name, 40, 105);
  return trim(cv);
}
async function useSig() {
  let res = null;
  if (sigTab === 'draw') { if (sigInk) res = trim(sigC()); }
  else { const name = $('#sigName').value.trim(); if (name) res = await typedSignature(name); }
  if (!res) { toast(sigTab === 'draw' ? 'Draw your signature in the box first.' : 'Type your name first.'); return; }
  finish(res);
}
export function initSignature() {
  const c = sigC(); let drawing = false, last = null, mid = null, active = null, penSeen = false; const ctx = () => c.getContext('2d'), INK = '#1a2a5c';
  const pt = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
  const widthFor = e => e.pointerType === 'pen' && e.pressure > 0 ? 2.4 + e.pressure * 5.6 : 5.2;
  // one pointer at a time; while a pen is in use a resting palm (touch) is ignored; strokes are smoothed
  // through the midpoints of the sampled points and use every coalesced sample the browser has
  c.addEventListener('pointerdown', e => {
    if (active != null) return;
    if (e.pointerType === 'touch' && penSeen) return;
    if (e.pointerType === 'pen') penSeen = true;
    e.preventDefault(); active = e.pointerId; drawing = true; last = pt(e); mid = last;
    try { c.setPointerCapture(e.pointerId); } catch {}
    const g = ctx(); g.fillStyle = INK; g.beginPath(); g.arc(last[0], last[1], widthFor(e) / 2, 0, 7); g.fill(); sigInk = true;
  });
  c.addEventListener('pointermove', e => {
    if (!drawing || e.pointerId !== active) return;
    e.preventDefault();
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || []; if (!evs.length) evs.push(e);
    const g = ctx(); g.strokeStyle = INK; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const ev of evs) {
      const p = pt(ev), m = [(last[0] + p[0]) / 2, (last[1] + p[1]) / 2];
      g.lineWidth = widthFor(ev); g.beginPath(); g.moveTo(mid[0], mid[1]); g.quadraticCurveTo(last[0], last[1], m[0], m[1]); g.stroke();
      last = p; mid = m;
    }
  });
  const end = e => { if (e && active != null && e.pointerId !== active) return; if (drawing && last && mid) { const g = ctx(); g.strokeStyle = INK; g.lineCap = 'round'; g.beginPath(); g.moveTo(mid[0], mid[1]); g.lineTo(last[0], last[1]); g.stroke(); } drawing = false; active = null; };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end); c.addEventListener('lostpointercapture', end);
  $$('[data-sigtab]').forEach(b => b.addEventListener('click', () => { setSigTab(b.dataset.sigtab); if (b.dataset.sigtab === 'draw') sizeSig(); }));
  $('#sigName').addEventListener('input', () => { $('#sigPrev').textContent = $('#sigName').value || ' '; });
  $('#sigName').addEventListener('keydown', e => { if (e.key === 'Enter') useSig(); });
  $('#sigClear').addEventListener('click', () => { if (sigTab === 'draw') { ctx().clearRect(0, 0, c.width, c.height); sigInk = false; } else { $('#sigName').value = ''; $('#sigPrev').textContent = ' '; } });
  $('#sigCancel').addEventListener('click', () => finish(null));
  $('#sigUse').addEventListener('click', useSig);
  $('#sigModal').addEventListener('pointerdown', e => { if (e.target.id === 'sigModal') finish(null); });
  addEventListener('keydown', e => { if (!$('#sigModal').hidden && e.key === 'Escape') { e.stopPropagation(); finish(null); } }, true);
}

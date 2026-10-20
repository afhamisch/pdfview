// Page geometry in PDF user space. Ported from Jonathan's PDF Desk, which got rotated pages right.
// An object stores its visual top-left corner (x, y) in user space, its visual size, and the page
// rotation (a) it was placed under; offset() walks along the rotated axes.
import { S } from './state.js';
export function frame(a) { const A = a * Math.PI / 180; return { c: Math.cos(A), s: Math.sin(A) }; }
export function offset(P, a, u, v) { const { c, s } = frame(a); return [P[0] + u * c + v * s, P[1] + u * s - v * c]; }
export function rotOf(p) { return (p.base + p.rot) % 360; }
export function toWorld(p, e) { const r = p.sheet.getBoundingClientRect(); return p.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top); }
export function place(el, p, o) {
  const [l, t] = p.vp.convertToViewportPoint(o.x, o.y);
  el.style.left = l + 'px'; el.style.top = t + 'px';
  if (o.w != null) el.style.width = o.w * S.scale + 'px';
  if (o.h != null) el.style.height = o.h * S.scale + 'px';
  const rr = ((rotOf(p) - (o.a || 0)) % 360 + 360) % 360;
  el.style.transform = rr ? `rotate(${rr}deg)` : '';
}
export function rectFrom(P0, E, a) {
  const { c, s } = frame(a); const dx = E[0] - P0[0], dy = E[1] - P0[1];
  const u = dx * c + dy * s, v = dx * s - dy * c; const tl = offset(P0, a, Math.min(u, 0), Math.min(v, 0));
  return { x: tl[0], y: tl[1], w: Math.abs(u), h: Math.abs(v), a };
}

// Small DOM helpers, icons, toasts and modals.
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
let toastT;
export function toast(msg, ms = 3600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const ICON = {
  open: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  side: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  find: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  minus: svg('<path d="M5 12h14"/>'), plus: svg('<path d="M12 5v14M5 12h14"/>'),
  fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'), down: svg('<path d="M6 9l6 6 6-6"/>'),
  rl: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  rr: svg('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>'),
  del: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  select: svg('<path d="M5 3l14 7-6 2-2 6z"/>'),
  text: svg('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'),
  ocr: svg('<path d="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3"/><path d="M8 12h8M12 9v6"/>'),
  stamp: svg('<rect x="3.5" y="6.5" width="17" height="11" rx="1.5"/><path d="M7 12h10"/>'),
  check: svg('<path d="M4 12.5l5 5L20 6"/>', 'stroke-width="2.2"'),
  sign: svg('<path d="M3 20h18"/><path d="M6 16l9.5-9.5 3 3L9 19H6z"/>'),
  highlight: svg('<path d="M9 11l6-6 4 4-6 6z"/><path d="M9 11l-4 4v3h3l5-3"/><path d="M14 20h7"/>'),
  whiteout: svg('<rect x="4" y="6" width="16" height="12" rx="1.5"/><path d="M8 12h8"/>'),
  redact: svg('<path d="M4 6h9M4 18h12"/><rect x="3.5" y="9.5" width="17" height="5" rx=".5" fill="currentColor"/>'),
  org: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>'),
  bates: svg('<path d="M4 6h16M4 12h10M4 18h16"/><path d="M17 10l3 2-3 2"/>'),
  save: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  print: svg('<path d="M6 9V4h12v5"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M8 17v3h8v-3"/>'),
  send: svg('<path d="M4 12l16-8-6 16-2-7z"/>'),
  tick: svg('<path d="M5 12.5l4.5 4.5L19 7"/>', 'stroke-width="3"'),
  ins: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M12 11v6M9 14h6"/>'),
  cb: svg('<path d="M4 12.5l5 5L20 6"/>', 'stroke-width="3.2"'),
  field: svg('<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h4"/>'),
  link: svg('<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>'),
  back: svg('<path d="M15 6l-6 6 6 6"/>'),
  alignL: svg('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'), alignC: svg('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'), alignR: svg('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'), alignJ: svg('<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>'),
  theme: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>')
};
export function btn(label, { icon, cls = 'tb', title, onclick, id, data, disabled } = {}) {
  const b = el('button', { type: 'button', class: cls, title: title || label, id, disabled });
  if (icon) b.insertAdjacentHTML('beforeend', ICON[icon] || icon);
  if (label) b.append(el('span', { class: 't', text: label }));
  if (data) Object.assign(b.dataset, data);
  if (onclick) b.addEventListener('click', onclick);
  return b;
}
export function openModal(id) { const m = $('#' + id); m.hidden = false; const f = m.querySelector('[autofocus],input,button.primary,button'); if (f) f.focus(); return m; }
export function closeModal(id) { $('#' + id).hidden = true; }
export function anyModalOpen() { return $$('.mback').some(m => !m.hidden); }
export function fmtBytes(n) { return n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }

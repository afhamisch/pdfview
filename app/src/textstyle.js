// Text formatting shared by the editor and the save path: fonts, bold, italic, underline, alignment,
// lists and wrapped text boxes. Layout is computed from font metrics so the saved PDF matches the screen.
import { S } from './state.js';
import { el, ICON } from './ui.js';

export const FONTS = { helv: { label: 'Helvetica', css: 'Helvetica, Arial, sans-serif' }, times: { label: 'Times', css: '"Times New Roman", Times, serif' }, courier: { label: 'Courier', css: '"Courier New", Courier, monospace' } };
export const DEFAULT_STYLE = { font: 'helv', bold: false, italic: false, underline: false, align: 'left', list: 'none' };
export const PAD = 2, LINE = 1.2;
export const listPrefix = (o, i) => o.list === 'bullet' ? '• ' : o.list === 'number' ? `${i + 1}. ` : '';

// Apply an object's style to its on-screen element.
export function applyStyle(t, o) {
  const f = FONTS[o.font] || FONTS.helv;
  Object.assign(t.style, { fontFamily: f.css, fontWeight: o.bold ? '700' : '400', fontStyle: o.italic ? 'italic' : 'normal', textDecoration: o.underline ? 'underline' : 'none', textAlign: o.align || 'left' });
  if (o.w) { t.style.width = '100%'; t.style.whiteSpace = 'pre-wrap'; t.style.overflowWrap = 'break-word'; }
  if (o.list && o.list !== 'none') { t.classList.add('list'); t.style.paddingLeft = (o.list === 'number' ? 1.7 : 1.1) * o.size * S.scale + PAD * S.scale + 'px'; t.style.textIndent = -(o.list === 'number' ? 1.7 : 1.1) * o.size * S.scale + 'px'; }
}
export const displayText = o => (o.list && o.list !== 'none') ? o.text.split('\n').map((l, i) => listPrefix(o, i) + l).join('\n') : o.text;

/* Line layout for the PDF. measure(str) returns the width of str at the object's size in the object's font.
   Returns lines of { words, text, width, indent, justify, first } in reading order. */
export function layoutLines(o, measure) {
  const pad = PAD, maxW = o.w ? Math.max(10, o.w - 2 * pad) : Infinity, out = [];
  const paras = String(o.text || '').replace(/\t/g, '    ').split('\n');
  paras.forEach((para, pi) => {
    const prefix = listPrefix(o, pi), indent = prefix ? measure(prefix) : 0, avail = maxW - indent;
    const words = para.split(' ');
    let line = [], lw = 0, first = true;
    const flush = (last) => { const text = line.join(' '); out.push({ words: line, text, width: measure(text), indent, prefix: first ? prefix : '', justify: o.align === 'justify' && !!o.w && !last && line.length > 1, first }); first = false; line = []; lw = 0; };
    for (const w of words) {
      const ww = measure(w), sp = line.length ? measure(' ') : 0;
      if (line.length && lw + sp + ww > avail) flush(false);
      line.push(w); lw += (line.length > 1 ? measure(' ') : 0) + ww;
    }
    flush(true);
  });
  return out;
}
export function boxWidth(o, lines) { return o.w ? o.w - 2 * PAD : Math.max(...lines.map(l => l.indent + l.width), 1); }

/* Toolbar in the context strip. target is a text object (changes are undoable) or the default style. */
export function textToolbar(c, target, { onChange, isDefault = false } = {}) {
  const change = (mut) => { onChange(mut); };
  const font = el('select', { class: 'ctl', 'aria-label': 'Font' }); Object.entries(FONTS).forEach(([k, f]) => font.append(el('option', { value: k, text: f.label }))); font.value = target.font || 'helv';
  font.addEventListener('change', () => change(o => { o.font = font.value; }));
  const size = el('input', { class: 'ctl', type: 'number', min: 4, max: 96, step: 1, value: target.size || S.tsize, 'aria-label': 'Size', title: 'Size in points', style: { width: '64px' }, list: 'sizeList' });
  size.classList.add('sizein');
  if (!document.getElementById('sizeList')) { const dl = el('datalist', { id: 'sizeList' }); [8, 9, 10, 11, 12, 14, 16, 18, 24, 32, 48].forEach(n => dl.append(el('option', { value: n }))); document.body.append(dl); }
  size.addEventListener('change', () => { const v = Math.max(4, Math.min(96, +size.value || 11)); size.value = v; change(o => { o.size = v; }); });
  size.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); size.blur(); } });
  const tog = (key, label, title, html) => { const b = el('button', { type: 'button', class: 'mini fmt', title, 'aria-label': title, 'aria-pressed': String(!!target[key]), html: html || label }); b.addEventListener('pointerdown', e => e.preventDefault()); b.addEventListener('click', () => change(o => { o[key] = !o[key]; })); return b; };
  const alignBtn = (v, title, icon) => { const b = el('button', { type: 'button', class: 'mini fmt', title, 'aria-label': title, 'aria-pressed': String((target.align || 'left') === v), html: icon }); b.addEventListener('pointerdown', e => e.preventDefault()); b.addEventListener('click', () => change(o => { o.align = v; })); return b; };
  const list = el('select', { class: 'ctl', 'aria-label': 'List' }); [['none', 'No list'], ['bullet', 'Bullets'], ['number', 'Numbered']].forEach(([v, t]) => list.append(el('option', { value: v, text: t }))); list.value = target.list || 'none';
  list.addEventListener('change', () => change(o => { o.list = list.value; }));
  const color = el('input', { type: 'color', class: 'colorpick', value: target.color || S.tcolor, title: 'Text color', 'aria-label': 'Text color' });
  color.addEventListener('change', () => change(o => { o.color = color.value; }));
  c.append(font, size, el('span', { class: 'fmtgrp' }, tog('bold', 'B', 'Bold (Ctrl+B)', '<b>B</b>'), tog('italic', 'I', 'Italic (Ctrl+I)', '<i>I</i>'), tog('underline', 'U', 'Underline (Ctrl+U)', '<u>U</u>')),
    el('span', { class: 'fmtgrp' }, alignBtn('left', 'Align left', ICON.alignL), alignBtn('center', 'Center', ICON.alignC), alignBtn('right', 'Align right', ICON.alignR), alignBtn('justify', 'Justify (needs a box width: drag the corner handle)', ICON.alignJ)),
    list, color);
  if (isDefault) c.append(el('span', { class: 'muted-note', text: 'Applies to new text. Drag a text box corner to set a width; long lines then wrap.' }));
}

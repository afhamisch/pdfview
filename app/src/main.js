import 'pdfjs-dist/web/pdf_viewer.css';
import './fonts.css';
import './styles.css';
import { S, on, emit, versionLabel } from './state.js';
import { $, $$, el, toast, anyModalOpen, ICON } from './ui.js';
import { SHELL, REST } from './shell.js';
import { pdfjs } from './pdfjs.js';
import { openBytes, readFile } from './document.js';
import { switchTab, switchBy, closeTab, tabName, tabSample, tabDirty, anyDirty } from './tabs.js';
import { initViewer, layout, zoomTo, goTo, currentPage, updateNav, setHooks } from './viewer.js';
import { initSearch, openFind, applyHighlights } from './search.js';
import { initSidebar, toggleSide } from './sidebar.js';
import { makeSample } from './sample.js';
import { ctxHooks, keyHooks } from './hooks.js';
import { initDesktop } from './desktop.js';
import { initFonts } from './fonts.js';
import { pickFiles, openFromHandle, handlesFromDrop } from './fileio.js';
import { initInfo } from './info.js';
import { popOut, initPopout } from './popout.js';
import { initTheme, initSettings } from './settings.js';

/* theme: 'system' (default), 'light' or 'dark'; applied before the shell is drawn so nothing flashes */
initTheme();
document.getElementById('app').innerHTML = SHELL;
document.body.dataset.tool = 'select';
initTheme();

const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.5h8l5 5V21a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 21z"/><path d="M14 2.5v5h5"/><path d="M9 13h6M9 17h6"/></svg>';
let dragTab = null;
function tabMenu(t, x, y) {
  document.querySelectorAll('.tabmenu').forEach(m => m.remove());
  const m = el('div', { class: 'tabmenu', role: 'menu' });
  const item = (text, fn) => { const b = el('button', { type: 'button', role: 'menuitem', text }); b.addEventListener('click', () => { m.remove(); fn(); }); m.append(b); };
  item('Open in new window', () => popOut(t));
  item('Close', () => requestClose(t));
  if (S.tabs.length > 1) item('Close other tabs', () => { for (const o of [...S.tabs]) if (o !== t) requestClose(o); });
  document.body.append(m); m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px'; m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px';
  const away = e => { if (!m.contains(e.target)) { m.remove(); removeEventListener('pointerdown', away, true); } }; setTimeout(() => addEventListener('pointerdown', away, true), 0);
  addEventListener('keydown', e => { if (e.key === 'Escape') m.remove(); }, { once: true });
}
function renderTabs() {
  const host = $('#tabs'), bar = $('#tabbar'); if (!host) return; host.innerHTML = '';
  if (bar) bar.hidden = !S.tabs.length;
  if (!S.tabs.length) return;
  for (const t of S.tabs) {
    const active = t === S.tab, name = tabName(t) || 'document.pdf';
    const b = el('div', { class: 'tab', role: 'tab', 'aria-selected': String(active), title: name + (tabDirty(t) ? ' (unsaved changes)' : ''), tabindex: '0', dataset: { tab: t.id } }, el('span', { class: 'ic', html: FILE_ICON }), el('span', { class: 'nm', text: name.replace(/\.pdf$/i, '') }));
    if (tabSample(t)) b.append(el('span', { class: 'tag', text: 'Sample' }));
    if (tabDirty(t)) b.append(el('span', { class: 'dot', title: 'Unsaved changes' }));
    const x = el('button', { class: 'x', type: 'button', title: 'Close', 'aria-label': 'Close ' + name, html: ICON.close });
    x.addEventListener('click', e => { e.stopPropagation(); requestClose(t); });
    b.append(x);
    b.addEventListener('click', () => switchTab(t));
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(t); } });
    b.addEventListener('contextmenu', e => { e.preventDefault(); tabMenu(t, e.clientX, e.clientY); });
    // drag within the strip reorders; drop outside the window moves the tab to a new window
    b.draggable = true;
    b.addEventListener('dragstart', e => { dragTab = t; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(t.id)); } catch {} b.classList.add('dragging'); });
    b.addEventListener('dragover', e => { if (dragTab && dragTab !== t) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; b.classList.add('dropat'); } });
    b.addEventListener('dragleave', () => b.classList.remove('dropat'));
    b.addEventListener('drop', e => { if (!dragTab || dragTab === t) return; e.preventDefault(); e.stopPropagation(); const from = S.tabs.indexOf(dragTab), to = S.tabs.indexOf(t); if (from < 0 || to < 0) return; S.tabs.splice(from, 1); S.tabs.splice(to, 0, dragTab); dragTab = null; renderTabs(); });
    b.addEventListener('dragend', e => { const was = dragTab; dragTab = null; b.classList.remove('dragging'); host.querySelectorAll('.dropat').forEach(x => x.classList.remove('dropat')); if (!was) return; const outside = e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight; if (outside) popOut(was); });
    host.append(b);
  }
  const cur = host.querySelector('.tab[aria-selected="true"]'); if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {} }
}
export function setEnabled(onOff) {
  $$('#tools .tb,#zoomIn,#zoomOut,#zoomFit,#pgIn,#pgPrev,#pgNext,#saveBtn,#saveAsBtn,#orgBtn,#batesBtn,#ocrBtn,#infoBtn,#printBtn,#sendBtn,#findBtn').forEach(b => b.disabled = !onOff);
  $('#undoBtn').disabled = !onOff || !S.undo.length; $('#redoBtn').disabled = !onOff || !S.redo.length;
  if (!onOff) { $('#zoomPct').textContent = '100%'; $('#pgIn').value = ''; $('#pgOf').textContent = 'of 0'; }
}
export function showRest() {
  $('#pages').innerHTML = REST;
  $('#restOpen').addEventListener('click', pickFiles);
  $('#restSample').addEventListener('click', loadSample);
  $('#restVer').textContent = versionLabel();
  renderTabs(); setEnabled(false); $('#dirtyDot').hidden = true; emit('ctx');
}
async function loadSample() { try { await openBytes(new Uint8Array(await makeSample()), 'sample-intake-form.pdf', { sample: true }); } catch (e) { console.error(e); toast('The sample form could not be created.'); } }
let closeArmed = { id: 0, at: 0 };
function requestClose(t) {
  if (!t) return;
  if (tabDirty(t) && !(closeArmed.id === t.id && Date.now() - closeArmed.at < 4000)) { closeArmed = { id: t.id, at: Date.now() }; toast(`${tabName(t)} has unsaved changes. Click its close button again to close it without saving.`); return; }
  closeArmed = { id: 0, at: 0 }; closeTab(t); if (!S.tabs.length) showRest();
}
on('doc:open', () => { renderTabs(); setEnabled(true); $('#dirtyDot').hidden = true; emit('ctx'); });
on('tab:switch', () => { renderTabs(); setEnabled(true); $('#dirtyDot').hidden = !S.dirty; $('#undoBtn').disabled = !S.undo.length; $('#redoBtn').disabled = !S.redo.length; emit('ctx'); });
on('tabs:changed', renderTabs); on('dirty', renderTabs); on('show:rest', () => { if (!S.tabs.length) showRest(); });
on('doc:close', () => { $('#findbar').hidden = true; });

/* ---------- context strip ---------- */
const HINT = {
  select: 'Select text to copy it, or click a field to fill it in. Click an added item to select it, drag to move it.',
  text: 'Click on the page where the text should start.', stamp: 'Pick a stamp, then click on the page to place it. Double-click a placed stamp to change its wording.', check: 'Click on the page to place a check mark.', sign: 'Click on the page to place your signature.',
  highlight: 'Drag across text to highlight it, or drag a box over anything.', draw: 'Draw freehand with the marker or pen. Hold Shift for a straight line.', shape: 'Drag on the page to draw the shape.', erase: 'Drag over the part you want gone; it is painted white, like correction fluid.', snap: 'Drag a box around the part of the page you want; it is copied as an image, with buttons for the text or a PNG file.', whiteout: 'Drag a white box over anything you want to cover.',
  redact: 'Drag a black box over anything you want to redact. When you save, everything under the boxes is permanently removed from the file.',
  note: 'Click on the page to place a note. It is saved as a comment that Adobe and other viewers show.',
  field: 'Click on the page to place the field for the selected signer.'
};
on('ctx', () => {
  const c = $('#ctx'); c.innerHTML = '';
  if (!S.doc) { c.textContent = 'No PDF open. Tools turn on once you open one.'; return; }
  if (ctxHooks.render && ctxHooks.render(c)) return;
  c.append(el('span', { text: HINT[S.tool] || '' }));
});

/* ---------- wiring ---------- */
$('#openBtn').addEventListener('click', pickFiles);
async function openFiles(files) {
  let n = 0; for (const f of files) if (await readFile(f)) n++;
  if (n > 1) toast(`Opened ${n} files, one per tab. To combine files into one, use Organize and Insert.`);
}
$('#tabPlus').addEventListener('click', pickFiles);
$('#fileIn').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) openFiles(files); });
$('#findBtn').addEventListener('click', openFind);
let dragN = 0;
addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragN++; $('#dropHint').textContent = S.org ? 'Drop the PDF to insert its pages' : 'Drop the PDF to open it'; $('#dropHint').hidden = false; } });
addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#dropHint').hidden = true; });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#dropHint').hidden = true; const fs = [...(e.dataTransfer?.files || [])]; if (!fs.length || anyModalOpen()) return; if (S.org) { emit('drop', fs[0]); return; } openDropped(fs, handlesFromDrop(e.dataTransfer)); });
async function openDropped(files, hs) { let n = 0; for (let i = 0; i < files.length; i++) { let h = null; try { h = await hs[i]; } catch {} if (h && h.kind === 'file' ? await openFromHandle(h) : await readFile(files[i])) n++; } if (n > 1) toast(`Opened ${n} files, one per tab. To combine files into one, use Organize and Insert.`); }
addEventListener('beforeunload', e => { if (anyDirty()) { e.preventDefault(); e.returnValue = ''; } });

addEventListener('keydown', e => {
  const typing = e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'f' && S.doc && !S.org) { e.preventDefault(); openFind(); return; }
  for (const h of keyHooks) if (h(e, { typing, mod }) === true) return;
  if (anyModalOpen() || typing) return;
  if (mod && S.doc && !S.org && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) { e.preventDefault(); e.key === '0' ? zoomTo(0, 'width') : zoomTo(S.scale * (e.key === '-' ? 1 / 1.2 : 1.2), null); return; }
  if (mod && e.key.toLowerCase() === 'b' && S.doc) { e.preventDefault(); toggleSide(); return; }
  // Ctrl+] and Ctrl+[ work in a browser; Ctrl+PageDown, Ctrl+PageUp and Ctrl+Tab reach the page only in the desktop app
  if (mod && (e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Tab' || e.key === ']' || e.key === '[') && S.tabs.length > 1) { e.preventDefault(); switchBy(e.key === 'PageUp' || e.key === '[' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1); return; }
  if (mod && e.key.toLowerCase() === 'w' && S.tab && !e.shiftKey) { e.preventDefault(); requestClose(S.tab); return; }
});

setHooks({ afterTextLayer: p => applyHighlights(p) });
import('./ocr.js').then(m => setHooks({ ocrLayer: m.renderOcrLayer }));
initViewer(); initSearch(); initSidebar(); initInfo(); initPopout(); initSettings();
const mods = await Promise.all([import('./editor.js'), import('./organize.js'), import('./bates.js'), import('./save.js'), import('./sign/index.js'), import('./ocr.js')].map(p => p.catch(e => { console.warn('module', e); return null; })));
for (const m of mods) if (m && m.init) m.init();
await Promise.all([pdfjs(), initFonts()]);
initDesktop();
if (location.pathname.startsWith('/sign/') && mods[4]) mods[4].startSigner(location.pathname.slice(6));
else showRest();
// Hooks for a desktop wrapper (see desktop/README.md): open a file handed over by the OS.
window.pdfviewOpen = (bytes, name) => openBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), name || 'document.pdf');
document.body.dataset.ready = '1';

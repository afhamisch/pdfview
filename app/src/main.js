import 'pdfjs-dist/web/pdf_viewer.css';
import './fonts.css';
import './styles.css';
import { S, on, emit } from './state.js';
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

/* theme: 'system' (default), 'light' or 'dark'; Jonathan's palette follows the OS unless overridden */
const THEME_KEY = 'pdfview.theme', THEMES = ['system', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const b = document.getElementById('themeBtn'); if (b) b.title = t === 'system' ? 'Theme: follows your system. Click for light.' : t === 'light' ? 'Theme: light. Click for dark.' : 'Theme: dark. Click to follow your system.';
}
let theme = 'system'; try { theme = THEMES.includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : 'system'; } catch {}
applyTheme(theme);
document.getElementById('app').innerHTML = SHELL;
document.body.dataset.tool = 'select';
applyTheme(theme);
$('#themeBtn').addEventListener('click', () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; try { localStorage.setItem(THEME_KEY, theme); } catch {} applyTheme(theme); });

function renderTabs() {
  const host = $('#tabs'); if (!host) return; host.innerHTML = '';
  if (!S.tabs.length) { host.append(el('span', { class: 'nofile', text: 'No file' })); return; }
  for (const t of S.tabs) {
    const active = t === S.tab, name = tabName(t) || 'document.pdf';
    const b = el('div', { class: 'tab', role: 'tab', 'aria-selected': String(active), title: name + (tabDirty(t) ? ' (unsaved changes)' : ''), tabindex: '0', dataset: { tab: t.id } }, el('span', { class: 'nm', text: name }));
    if (tabSample(t)) b.append(el('span', { class: 'tag', text: 'Sample' }));
    if (tabDirty(t)) b.append(el('span', { class: 'dot', title: 'Unsaved changes' }));
    const x = el('button', { class: 'x', type: 'button', title: 'Close', 'aria-label': 'Close ' + name, html: ICON.close });
    x.addEventListener('click', e => { e.stopPropagation(); requestClose(t); });
    b.append(x);
    b.addEventListener('click', () => switchTab(t));
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(t); } });
    host.append(b);
  }
  const cur = host.querySelector('.tab[aria-selected="true"]'); if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {} }
}
export function setEnabled(onOff) {
  $$('#tools .tb,#zoomIn,#zoomOut,#zoomFit,#pgIn,#pgPrev,#pgNext,#saveBtn,#orgBtn,#batesBtn,#ocrBtn,#printBtn,#sendBtn,#findBtn').forEach(b => b.disabled = !onOff);
  $('#undoBtn').disabled = !onOff || !S.undo.length;
  if (!onOff) { $('#zoomPct').textContent = '100%'; $('#pgIn').value = ''; $('#pgOf').textContent = 'of 0'; }
}
export function showRest() {
  $('#pages').innerHTML = REST;
  $('#restOpen').addEventListener('click', () => $('#fileIn').click());
  $('#restSample').addEventListener('click', loadSample);
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
on('tab:switch', () => { renderTabs(); setEnabled(true); $('#dirtyDot').hidden = !S.dirty; $('#undoBtn').disabled = !S.undo.length; emit('ctx'); });
on('tabs:changed', renderTabs); on('dirty', renderTabs);
on('doc:close', () => { $('#findbar').hidden = true; });

/* ---------- context strip ---------- */
const HINT = {
  select: 'Select text to copy it, or click a field to fill it in. Click an added item to select it, drag to move it.',
  text: 'Click on the page where the text should start.', stamp: 'Pick a stamp, then click on the page to place it. Double-click a placed stamp to change its wording.', check: 'Click on the page to place a check mark.', sign: 'Click on the page to place your signature.',
  highlight: 'Drag across text to highlight it, or drag a box over anything.', draw: 'Draw freehand with the marker or pen.', shape: 'Drag on the page to draw the shape.', erase: 'Drag over the part you want gone; it is painted white, like correction fluid.', snap: 'Drag a box around the part of the page you want; it is copied as an image, with buttons for the text or a PNG file.', whiteout: 'Drag a white box over anything you want to cover.',
  redact: 'Drag a black box over anything you want to redact. When you save, everything under the boxes is permanently removed from the file.',
  field: 'Click on the page to place the field for the selected signer.'
};
on('ctx', () => {
  const c = $('#ctx'); c.innerHTML = '';
  if (!S.doc) { c.textContent = 'No PDF open. Tools turn on once you open one.'; return; }
  if (ctxHooks.render && ctxHooks.render(c)) return;
  c.append(el('span', { text: HINT[S.tool] || '' }));
});

/* ---------- wiring ---------- */
$('#openBtn').addEventListener('click', () => $('#fileIn').click());
async function openFiles(files) {
  let n = 0; for (const f of files) if (await readFile(f)) n++;
  if (n > 1) toast(`Opened ${n} files, one per tab. To combine files into one, use Organize and Insert.`);
}
$('#fileIn').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) openFiles(files); });
$('#findBtn').addEventListener('click', openFind);
let dragN = 0;
addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragN++; $('#dropHint').textContent = S.org ? 'Drop the PDF to insert its pages' : 'Drop the PDF to open it'; $('#dropHint').hidden = false; } });
addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#dropHint').hidden = true; });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#dropHint').hidden = true; const fs = [...(e.dataTransfer?.files || [])]; if (!fs.length || anyModalOpen()) return; if (fs.length > 1 && !S.org) emit('drop:many', fs); else emit('drop', fs[0]); });
on('drop', f => { if (!S.org) readFile(f); });
on('drop:many', files => { if (S.org || !files.length) return; openFiles(files); });
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
initViewer(); initSearch(); initSidebar();
const mods = await Promise.all([import('./editor.js'), import('./organize.js'), import('./bates.js'), import('./save.js'), import('./sign/index.js'), import('./ocr.js')].map(p => p.catch(e => { console.warn('module', e); return null; })));
for (const m of mods) if (m && m.init) m.init();
await Promise.all([pdfjs(), initFonts()]);
initDesktop();
if (location.pathname.startsWith('/sign/') && mods[4]) mods[4].startSigner(location.pathname.slice(6));
else showRest();
// Hooks for a desktop wrapper (see desktop/README.md): open a file handed over by the OS.
window.pdfviewOpen = (bytes, name) => openBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), name || 'document.pdf');
document.body.dataset.ready = '1';

import 'pdfjs-dist/web/pdf_viewer.css';
import './styles.css';
import { S, on, emit } from './state.js';
import { $, $$, el, toast, anyModalOpen } from './ui.js';
import { SHELL, REST } from './shell.js';
import { pdfjs } from './pdfjs.js';
import { openBytes, readFile, closeDoc } from './document.js';
import { initViewer, layout, zoomTo, goTo, currentPage, updateNav, setHooks } from './viewer.js';
import { initSearch, openFind, applyHighlights } from './search.js';
import { initSidebar, toggleSide } from './sidebar.js';
import { makeSample } from './sample.js';
import { ctxHooks, keyHooks } from './hooks.js';

document.getElementById('app').innerHTML = SHELL;
document.body.dataset.tool = 'select';

function setFileLabel() {
  const f = $('#fileName'); f.innerHTML = '';
  const b = el('b', { text: S.name || 'No file', title: S.name }); b.style.color = S.name ? '' : 'var(--muted)'; f.append(b);
  if (S.sample) f.append(el('span', { class: 'tag', text: 'Sample' }));
}
export function setEnabled(onOff) {
  $$('#tools .tb,#zoomIn,#zoomOut,#zoomFit,#pgIn,#pgPrev,#pgNext,#saveBtn,#orgBtn,#batesBtn,#printBtn,#sendBtn,#findBtn').forEach(b => b.disabled = !onOff);
  $('#undoBtn').disabled = !onOff || !S.undo.length;
  $('#closeBtn').hidden = !onOff;
  if (!onOff) { $('#zoomPct').textContent = '100%'; $('#pgIn').value = ''; $('#pgOf').textContent = 'of 0'; }
}
export function showRest() {
  $('#pages').innerHTML = REST;
  $('#restOpen').addEventListener('click', () => $('#fileIn').click());
  $('#restSample').addEventListener('click', loadSample);
  setFileLabel(); setEnabled(false); $('#dirtyDot').hidden = true; emit('ctx');
}
async function loadSample() { try { await openBytes(new Uint8Array(await makeSample()), 'sample-intake-form.pdf', { sample: true }); } catch (e) { console.error(e); toast('The sample form could not be created.'); } }
let closeArmed = 0;
function requestClose() {
  if (S.dirty && !S.sample && Date.now() - closeArmed > 4000) { closeArmed = Date.now(); toast('You have unsaved changes. Click close again to close without saving.'); return; }
  closeArmed = 0; closeDoc(); showRest();
}
on('doc:open', () => { setFileLabel(); setEnabled(true); $('#dirtyDot').hidden = true; emit('ctx'); });
on('doc:close', () => { $('#findbar').hidden = true; });

/* ---------- context strip ---------- */
const HINT = {
  select: 'Select text to copy it, or click a field to fill it in. Click an added item to select it, drag to move it.',
  text: 'Click on the page where the text should start.', check: 'Click on the page to place a check mark.', sign: 'Click on the page to place your signature.',
  highlight: 'Drag across the passage to highlight it.', whiteout: 'Drag a white box over anything you want to cover.',
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
$('#closeBtn').addEventListener('click', requestClose);
$('#fileIn').addEventListener('change', e => { readFile(e.target.files[0]); e.target.value = ''; });
$('#findBtn').addEventListener('click', openFind);
let dragN = 0;
addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragN++; $('#dropHint').textContent = S.org ? 'Drop the PDF to insert its pages' : 'Drop the PDF to open it'; $('#dropHint').hidden = false; } });
addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#dropHint').hidden = true; });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#dropHint').hidden = true; const f = e.dataTransfer?.files?.[0]; if (!f || anyModalOpen()) return; emit('drop', f); });
on('drop', f => { if (!S.org) readFile(f); });
addEventListener('beforeunload', e => { if (S.dirty && !S.sample) { e.preventDefault(); e.returnValue = ''; } });

addEventListener('keydown', e => {
  const typing = e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'f' && S.doc && !S.org) { e.preventDefault(); openFind(); return; }
  for (const h of keyHooks) if (h(e, { typing, mod }) === true) return;
  if (anyModalOpen() || typing) return;
  if (mod && S.doc && !S.org && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) { e.preventDefault(); e.key === '0' ? zoomTo(0, 'width') : zoomTo(S.scale * (e.key === '-' ? 1 / 1.2 : 1.2), null); return; }
  if (mod && e.key.toLowerCase() === 'b' && S.doc) { e.preventDefault(); toggleSide(); return; }
});

setHooks({ afterTextLayer: p => applyHighlights(p) });
initViewer(); initSearch(); initSidebar();
const mods = await Promise.all([import('./editor.js'), import('./organize.js'), import('./bates.js'), import('./save.js'), import('./sign/index.js')].map(p => p.catch(e => { console.warn('module', e); return null; })));
for (const m of mods) if (m && m.init) m.init();
await pdfjs();
if (location.pathname.startsWith('/sign/') && mods[4]) mods[4].startSigner(location.pathname.slice(6));
else showRest();
// Hooks for a desktop wrapper (see desktop/README.md): open a file handed over by the OS.
window.pdfviewOpen = (bytes, name) => openBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), name || 'document.pdf');
document.body.dataset.ready = '1';

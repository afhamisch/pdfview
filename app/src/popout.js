// Move a tab into its own window, so two documents can sit side by side. The document travels as a
// PDF with the editable layer (so placed items, notes and lifted text stay editable), the original
// location goes with it (so Save still writes in place), and the tab closes here.
// Desktop: the wrapper writes a temp file and opens a new window that picks it up on start.
// Browser: window.open plus postMessage; a file handle from Chrome's picker is cloned across.
import { S, on, emit } from './state.js';
import { buildPdf } from './save.js';
import { openBytes } from './document.js';
import { closeTab, switchTab } from './tabs.js';
import { toast } from './ui.js';

const T = () => window.__TAURI__;
let seq = 0; const pending = new Map(); // browser children waiting for their document: key -> { payload, source }

function sendTo(key) {
  const p = pending.get(key); if (!p || !p.payload || !p.source) return;
  const { name, bytes, file } = p.payload; pending.delete(key);
  try { p.source.postMessage({ type: 'pdfview:open', name, bytes: bytes.buffer, file }, location.origin, [bytes.buffer]); } catch (e) { console.warn('handoff', e); }
}
export async function popOut(tab) {
  if (!tab) return;
  if (tab !== S.tab) { switchTab(tab); if (S.tab !== tab) return; }
  if (S.saving || S.lifting) { toast('Wait a moment, then try again.'); return; }
  const name = S.name, file = S.file, desktop = !!(T() && T().core && T().core.invoke);
  let key = null, child = null;
  if (!desktop) { // the window must open inside the click or drag that asked for it, before any slow work
    key = 'pop' + Date.now() + '-' + (seq++);
    child = window.open(`${location.pathname}?pop=${key}`, '_blank', `popup=yes,width=${Math.max(900, Math.round(innerWidth * 0.8))},height=${Math.max(600, innerHeight)}`);
    if (!child) { toast('The browser blocked the new window. Allow pop-ups for this site and try again.'); return; }
    pending.set(key, { payload: null, source: null });
  }
  let bytes; try { ({ bytes } = await buildPdf({ transfer: true })); } catch (e) { console.error(e); toast('This document could not be moved to a new window.'); if (child) child.close(); return; }
  if (desktop) {
    try {
      const temp = await T().core.invoke('stash_file', bytes, { headers: { 'x-filename': encodeURIComponent(name) } });
      await T().core.invoke('open_window', { handoff: JSON.stringify({ temp, name, path: file && file.kind === 'path' ? file.path : null }) });
    } catch (e) { console.error(e); toast('The new window could not be opened.'); return; }
  } else {
    const p = pending.get(key); if (!p) return;
    p.payload = { name, bytes, file: file && file.kind === 'handle' ? file.handle : null }; sendTo(key);
  }
  S.dirty = false; closeTab(tab);
}
/* Both sides of the browser handoff. */
export function initPopout() {
  addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
    const d = e.data;
    if (d.type === 'pdfview:ready' && pending.has(d.key)) { pending.get(d.key).source = e.source; sendTo(d.key); }
    else if (d.type === 'pdfview:open' && d.bytes) openBytes(new Uint8Array(d.bytes), d.name || 'document.pdf', { file: d.file ? { kind: 'handle', handle: d.file } : null });
  });
  const key = new URLSearchParams(location.search).get('pop');
  if (key && window.opener) { try { window.opener.postMessage({ type: 'pdfview:ready', key }, location.origin); } catch {} }
  on('doc:close', () => { if (!S.tabs.length) emit('show:rest'); });
}

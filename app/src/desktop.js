// Bridge to the desktop wrapper (desktop/, Tauri). Present only when the page runs inside it:
// files opened from the OS arrive here, and Save goes through a native dialog instead of a download.
import { openBytes } from './document.js';
export function initDesktop() {
  const T = window.__TAURI__; if (!T?.core?.invoke) return;
  const { invoke } = T.core, { listen } = T.event;
  const openPath = async p => {
    try { const buf = await invoke('read_file', { path: p }); await openBytes(new Uint8Array(buf), p.split(/[\\/]/).pop()); }
    catch (e) { console.error('open from desktop', e); }
  };
  const openFirst = files => { if (Array.isArray(files) && files.length) openPath(files[0]); };
  listen('open-files', e => openFirst(e.payload));
  invoke('pending_files').then(openFirst).catch(() => {});
  window.pdfviewSaveHook = ({ filename, bytes }) => invoke('save_file', bytes, { headers: { 'x-filename': filename } });
  document.body.dataset.desktop = '1';
}

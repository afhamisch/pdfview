// Bridge to the desktop wrapper (desktop/, Tauri). Present only when the page runs inside it:
// files opened from the OS arrive here. Opening and saving through native dialogs is in fileio.js.
import { openFromPath } from './fileio.js';
export function initDesktop() {
  const T = window.__TAURI__; if (!T?.core?.invoke) return;
  const { invoke } = T.core, { listen } = T.event;
  const openAll = async files => { if (Array.isArray(files)) for (const p of files) await openFromPath(p); };
  listen('open-files', e => openAll(e.payload));
  invoke('pending_files').then(openAll).catch(() => {});
  document.body.dataset.desktop = '1';
}

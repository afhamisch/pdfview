// Bridge to the desktop wrapper (desktop/, Tauri). Present only when the page runs inside it:
// files opened from the OS arrive here, and the app checks GitHub for a newer release, installs it in
// the background and offers a restart. Opening and saving through native dialogs is in fileio.js.
import { openFromPath } from './fileio.js';
import { $ } from './ui.js';

async function checkForUpdate(T) {
  const up = T.updater, proc = T.process;
  if (!up || typeof up.check !== 'function') return;
  try {
    const u = await up.check(); if (!u) return;
    await u.downloadAndInstall();
    const bar = $('#updateBar'); if (!bar) return;
    $('#updateMsg').textContent = `PDFView ${u.version} is ready. Restart to finish the update.`;
    bar.hidden = false;
    $('#updateRestart').onclick = () => { if (proc && proc.relaunch) proc.relaunch(); };
    $('#updateLater').onclick = () => { bar.hidden = true; };
  } catch (e) { console.warn('update check', e); }
}
export function initDesktop() {
  const T = window.__TAURI__; if (!T?.core?.invoke) return;
  const { invoke } = T.core, { listen } = T.event;
  const openAll = async files => { if (Array.isArray(files)) for (const p of files) await openFromPath(p); };
  listen('open-files', e => openAll(e.payload));
  invoke('pending_files').then(openAll).catch(() => {});
  document.body.dataset.desktop = '1';
  setTimeout(() => checkForUpdate(T), 4000); setInterval(() => checkForUpdate(T), 4 * 3600 * 1000);
}

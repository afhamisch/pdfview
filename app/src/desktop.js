// Bridge to the desktop wrapper (desktop/, Tauri). Present only when the page runs inside it:
// files opened from the OS arrive here, and the app checks GitHub for a newer release, installs it in
// the background and offers a restart. Opening and saving through native dialogs is in fileio.js.
import { openFromPath } from './fileio.js';
import { openBytes } from './document.js';
import { $ } from './ui.js';
import { APP, versionLabel } from './state.js';

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
  const openAll = async files => {
    if (!Array.isArray(files)) return;
    for (const p of files) {
      if (typeof p === 'string' && p.startsWith('{')) { // a document moved here from another window (see popout.js)
        try { const h = JSON.parse(p); const buf = await invoke('read_file', { path: h.temp }); await openBytes(new Uint8Array(buf), h.name || 'document.pdf', { file: h.path ? { kind: 'path', path: h.path } : null }); invoke('remove_temp', { path: h.temp }).catch(() => {}); } catch (e) { console.error('handoff', e); }
      } else await openFromPath(p);
    }
  };
  listen('open-files', e => openAll(e.payload));
  invoke('pending_files').then(openAll).catch(() => {});
  document.body.dataset.desktop = '1';
  if (T.app?.getVersion) T.app.getVersion().then(v => { APP.version = v; document.title = `PDFView ${v}`; const el = $('#restVer'); if (el) el.textContent = versionLabel(); }).catch(() => {});
  setTimeout(() => checkForUpdate(T), 4000); setInterval(() => checkForUpdate(T), 4 * 3600 * 1000);
}

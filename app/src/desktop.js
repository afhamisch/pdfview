// Bridge to the desktop wrapper (desktop/, Tauri). Present only when the page runs inside it:
// files opened from the OS arrive here, and the app checks GitHub for a newer release, installs it in
// the background and offers a restart. Opening and saving through native dialogs is in fileio.js.
import { openFromPath } from './fileio.js';
import { openBytes } from './document.js';
import { $ } from './ui.js';
import { APP, versionLabel, emit } from './state.js';

let ready = null; // a version already downloaded and waiting for a restart
export function relaunch() { const proc = window.__TAURI__?.process; if (proc && proc.relaunch) proc.relaunch(); }
function showBar(version) {
  const bar = $('#updateBar'); if (!bar) return;
  $('#updateMsg').textContent = `PDFView ${version} is ready. Restart to finish the update.`;
  bar.hidden = false;
  $('#updateRestart').onclick = relaunch;
  $('#updateLater').onclick = () => { bar.hidden = true; };
}
/* Ask GitHub for a newer release; when there is one it is downloaded and installed at once and the
   app only needs a restart. Returns what happened so the Settings dialog can say it. */
export async function checkNow() {
  const T = window.__TAURI__, up = T?.updater;
  if (!up || typeof up.check !== 'function') return { status: 'unavailable' };
  if (ready) return { status: 'ready', version: ready };
  try {
    const u = await up.check(); if (!u) return { status: 'latest' };
    await u.downloadAndInstall();
    ready = u.version; showBar(u.version);
    return { status: 'ready', version: u.version };
  } catch (e) { console.warn('update check', e); return { status: 'error', message: String(e?.message || e) }; }
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
  if (T.app?.getVersion) T.app.getVersion().then(v => { APP.version = v; document.title = `PDFView ${v}`; const el = $('#restVer'); if (el) el.textContent = versionLabel(); emit('version'); }).catch(() => {});
  setTimeout(checkNow, 4000); setInterval(checkNow, 4 * 3600 * 1000);
}

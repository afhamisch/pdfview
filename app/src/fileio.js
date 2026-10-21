// Where files come from and where saves go. Three environments:
//   desktop wrapper (Tauri): native dialogs, paths, Save writes the opened file in place;
//   Chrome and Edge (File System Access API): a picker hands over a file handle, Save writes it in place;
//   any other browser: the file input to open, a download to save.
import { S, emit } from './state.js';
import { openBytes } from './document.js';
import { $, toast, plural } from './ui.js';

const T = () => window.__TAURI__;
export const isDesktop = () => !!(T() && T().core && T().core.invoke);
export const hasFsAccess = () => !isDesktop() && typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function' && window.isSecureContext;
const PDF_TYPES = [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }];
const baseName = p => String(p).split(/[\\/]/).pop();

export async function openFromPath(path) {
  try { const buf = await T().core.invoke('read_file', { path }); return await openBytes(new Uint8Array(buf), baseName(path), { file: { kind: 'path', path } }); }
  catch (e) { console.error('open from desktop', e); toast('That file could not be opened.'); return false; }
}
export async function openFromHandle(handle) {
  try { const f = await handle.getFile(); return await openBytes(new Uint8Array(await f.arrayBuffer()), f.name, { file: { kind: 'handle', handle } }); }
  catch (e) { console.error('open from handle', e); toast('That file could not be opened.'); return false; }
}
/* The Open button: native dialog, file picker, or the plain file input. */
export async function pickFiles() {
  if (isDesktop()) {
    let paths = []; try { paths = await T().core.invoke('open_files'); } catch (e) { console.warn(e); }
    let n = 0; for (const p of paths || []) if (await openFromPath(p)) n++;
    if (n > 1) toast(`Opened ${n} files, one per tab.`);
    return;
  }
  if (hasFsAccess()) {
    let handles; try { handles = await window.showOpenFilePicker({ multiple: true, types: PDF_TYPES }); } catch { return; }
    let n = 0; for (const h of handles) if (await openFromHandle(h)) n++;
    if (n > 1) toast(`Opened ${n} files, one per tab.`);
    return;
  }
  $('#fileIn').click();
}
/* Dropped files: Chrome can hand over handles so Save writes them in place. Call synchronously in the drop handler. */
export function handlesFromDrop(dt) {
  const items = [...((dt && dt.items) || [])];
  return items.map(it => it.kind === 'file' && typeof it.getAsFileSystemHandle === 'function' ? it.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null));
}

function download(bytes, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
/* Write a PDF out. Returns { ok, name, inPlace, download }. With as=false and a known file, writes it in
   place. Otherwise the desktop asks for a name; a browser downloads, unless pick is set (the person chose
   Save as) and Chrome's picker is available. adopt: the saved location becomes this tab's file (not for
   extracts and other side files). */
export async function writeOut(bytes, { name, as = false, pick = false, adopt = true } = {}) {
  const file = adopt ? S.file : null;
  if (!as && file) {
    if (file.kind === 'path' && isDesktop()) {
      await T().core.invoke('write_file', bytes, { headers: { 'x-path': encodeURIComponent(file.path) } });
      return { ok: true, name: S.name, inPlace: true };
    }
    if (file.kind === 'handle') {
      try {
        let perm = await file.handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await file.handle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') { const w = await file.handle.createWritable(); await w.write(bytes); await w.close(); return { ok: true, name: S.name, inPlace: true }; }
      } catch (e) { console.warn('write in place', e); }
    }
  }
  if (isDesktop()) {
    let path = null; try { path = await T().core.invoke('save_file', bytes, { headers: { 'x-filename': encodeURIComponent(name) } }); } catch (e) { console.error(e); throw e; }
    if (!path) return { ok: false };
    if (adopt) { S.file = { kind: 'path', path }; }
    return { ok: true, name: baseName(path) };
  }
  if (pick && hasFsAccess()) {
    let h; try { h = await window.showSaveFilePicker({ suggestedName: name, types: PDF_TYPES }); } catch { return { ok: false }; }
    const w = await h.createWritable(); await w.write(bytes); await w.close();
    if (adopt) S.file = { kind: 'handle', handle: h };
    return { ok: true, name: h.name };
  }
  download(bytes, name); return { ok: true, name, download: true };
}
export function fileLabel() {
  if (!S.file) return hasFsAccess() || isDesktop() ? 'Opened without a location: Save asks where to put it.' : '';
  return S.file.kind === 'path' ? S.file.path : 'Save writes back to the opened file.';
}
export { plural, emit };

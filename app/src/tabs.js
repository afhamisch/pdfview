// Several PDFs open at once. Each tab keeps a document's whole state (pages, placed items, undo,
// form values, recognized text) and its rendered page elements; switching swaps them in and out of
// the shared state object and the page host, so every module keeps working on "the" document.
import { S, emit, DOC_KEYS } from './state.js';
import { destroySources, blankDoc } from './document.js';
import { detachPages, attachPages } from './viewer.js';
import { closeFind } from './search.js';
import { closeOrg } from './organize.js';
import { toast } from './ui.js';

let seq = 1;
export function newTab() { const t = { id: seq++, state: null, sections: null, scrollTop: 0 }; S.tabs.push(t); return t; }
// Park the current document in its tab.
export function stashTab() {
  const t = S.tab; if (!t) return;
  closeFind(); if (S.org) closeOrg();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  t.state = {}; for (const k of DOC_KEYS) t.state[k] = S[k];
  detachPages(t);
}
function restoreTab(t) {
  Object.assign(S, t.state); t.state = null; S.tab = t;
  attachPages(t); emit('tab:switch');
}
export const busyNow = () => S.saving ? 'Wait for the save to finish.' : S.lifting ? 'One moment: the page is still being updated.' : '';
export function switchTab(t) {
  if (!t || t === S.tab || !S.tabs.includes(t)) return;
  const why = busyNow(); if (why) { toast(why); return; }
  stashTab(); restoreTab(t);
}
export function switchBy(delta) { if (S.tabs.length < 2) return; const i = S.tabs.indexOf(S.tab); switchTab(S.tabs[(i + delta + S.tabs.length) % S.tabs.length]); }
export const tabName = t => t === S.tab ? S.name : (t.state ? t.state.name : '');
export const tabSample = t => t === S.tab ? S.sample : !!(t.state && t.state.sample);
export const tabDirty = t => t === S.tab ? !!(S.dirty && !S.sample) : !!(t.state && t.state.dirty && !t.state.sample);
export function anyDirty() { return S.tabs.some(tabDirty); }
// Close a tab. Closing the active one shows its neighbor, or the empty screen when it was the last.
export function closeTab(t) {
  const i = S.tabs.indexOf(t); if (i < 0) return;
  if (t === S.tab) {
    const why = busyNow(); if (why) { toast(why); return; }
    closeFind(); if (S.org) closeOrg(); destroySources();
    S.tabs.splice(i, 1); S.tab = null;
    const next = S.tabs[Math.min(i, S.tabs.length - 1)];
    if (next) { restoreTab(next); emit('tabs:changed'); }
    else { blankDoc(); emit('doc:close'); }
  } else {
    try { for (const s of t.state.sources.values()) { try { s.doc.destroy(); } catch {} } } catch {}
    S.tabs.splice(i, 1); emit('tabs:changed');
  }
}

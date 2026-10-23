// Settings dialog (gear button): which build this is and a manual update check, the theme, the
// name written on notes, and the envelope service token when the app is served by the server.
// The theme itself lives here too, so the toolbar button and the dialog share one switch.
import { S, on, APP, versionLabel } from './state.js';
import { $, el, toast } from './ui.js';
import { keyHooks } from './hooks.js';
import { served, getToken, setToken } from './api.js';
import { checkNow, relaunch } from './desktop.js';

const THEME_KEY = 'pdfview.theme', THEMES = ['system', 'light', 'dark'];
let theme = 'system';
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const b = $('#themeBtn'); if (b) b.title = t === 'system' ? 'Theme: follows your system. Click for light.' : t === 'light' ? 'Theme: light. Click for dark.' : 'Theme: dark. Click to follow your system.';
  const sel = $('#setTheme'); if (sel && sel.value !== t) sel.value = t;
}
export function setTheme(t) { theme = THEMES.includes(t) ? t : 'system'; try { localStorage.setItem(THEME_KEY, theme); } catch {} applyTheme(theme); }
export function getTheme() { return theme; }
/* Read the saved theme before the shell is drawn so the page does not flash; called once by main.js. */
export function initTheme() { try { theme = THEMES.includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : 'system'; } catch {} applyTheme(theme); }

let modal = null;
export function closeSettings() { if (modal) { modal.remove(); modal = null; } }
export function openSettings() {
  if (modal) return;
  const m = el('div', { class: 'mback', id: 'settingsModal' }); modal = m;
  const desktop = !!window.__TAURI__;
  // About and updates
  const about = el('div', { class: 'srow' }, el('span', { id: 'setVersion', text: versionLabel() }));
  const status = el('span', { class: 'muted', id: 'updStatus' });
  const checkBtn = el('button', { class: 'btn', type: 'button', id: 'updCheck', text: 'Check for updates', onclick: async () => {
    checkBtn.disabled = true; status.textContent = 'Checking…'; status.className = 'muted';
    const r = await checkNow();
    checkBtn.disabled = false;
    if (r.status === 'latest') status.textContent = `You have the latest version${APP.version ? ` (${APP.version})` : ''}.`;
    else if (r.status === 'ready') { status.textContent = `Version ${r.version} is downloaded and installs when the app restarts. `; status.append(el('button', { class: 'btn primary', type: 'button', text: 'Restart now', onclick: relaunch })); }
    else if (r.status === 'unavailable') status.textContent = 'Updates are not available in this copy.';
    else { status.className = 'muted err'; status.textContent = `Could not check for updates${r.message ? `: ${r.message}` : ''}. Is the computer online?`; }
  } });
  const updates = desktop ? el('div', { class: 'srow' }, checkBtn, status)
    : el('p', { class: 'muted', text: __OFFLINE__ ? 'This is the single-file copy. A newer one can be downloaded from the Releases page.' : 'This copy comes from the website and is current each time the page is loaded.' });
  // Appearance
  const sel = el('select', { class: 'ctl', id: 'setTheme', 'aria-label': 'Theme' }, el('option', { value: 'system', text: 'Follow the system' }), el('option', { value: 'light', text: 'Light' }), el('option', { value: 'dark', text: 'Dark' }));
  sel.value = theme; sel.addEventListener('change', () => setTheme(sel.value));
  // Notes
  const author = el('input', { class: 'ctl', type: 'text', id: 'setAuthor', value: S.author || '', placeholder: 'Your name', 'aria-label': 'Name on notes' });
  author.addEventListener('change', () => { S.author = author.value.trim(); try { localStorage.setItem('pdfview.author', S.author); } catch {} });
  const rows = [el('h4', { text: 'About' }), about, updates, el('h4', { text: 'Appearance' }), el('label', { class: 'prow' }, el('span', { text: 'Theme' }), sel), el('h4', { text: 'Notes' }), el('label', { class: 'prow' }, el('span', { text: 'Name on notes' }), author)];
  // Envelope service (only when the server is serving the app)
  if (served()) {
    const tok = el('input', { class: 'ctl', type: 'password', id: 'setToken', value: getToken(), placeholder: 'Admin token', autocomplete: 'off', 'aria-label': 'Admin token' });
    tok.addEventListener('change', () => { setToken(tok.value.trim()); toast('Token saved.'); });
    rows.push(el('h4', { text: 'Envelope service' }), el('label', { class: 'prow' }, el('span', { text: 'Admin token' }), tok), el('p', { class: 'muted small', text: 'Printed when the server starts (also in data/admin-token.txt). Needed to send documents for signature.' }));
  }
  const box = el('div', { class: 'modal settings', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'setTitle' }, el('h3', { id: 'setTitle', text: 'Settings' }), ...rows, el('div', { class: 'mfoot' }, el('button', { class: 'btn', type: 'button', text: 'Close', onclick: closeSettings })));
  m.append(box); document.body.append(m);
  m.addEventListener('pointerdown', e => { if (e.target === m) closeSettings(); });
}
export function initSettings() {
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#themeBtn').addEventListener('click', () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]));
  keyHooks.push(e => { if (modal && e.key === 'Escape') { closeSettings(); return true; } return false; });
  on('version', () => { const v = $('#setVersion'); if (v) v.textContent = versionLabel(); });
}

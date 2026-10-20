// Calls to the envelope service. The admin token is kept in localStorage and asked for on a 401.
import { el, $ } from './ui.js';
const KEY = 'pdfview.adminToken';
export const served = () => location.protocol.startsWith('http') && !__OFFLINE__ && !window.__TAURI__;
export function getToken() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
export function setToken(t) { try { localStorage.setItem(KEY, t); } catch {} }
export function askToken(message) {
  return new Promise(res => {
    const m = el('div', { class: 'mback' });
    const inp = el('input', { type: 'password', placeholder: 'Admin token', autocomplete: 'off', style: { width: '100%', height: '34px', border: '1px solid var(--line)', borderRadius: '6px', padding: '0 8px', font: 'inherit' } });
    const ok = el('button', { class: 'btn primary', type: 'button', text: 'Continue', onclick: () => { setToken(inp.value.trim()); m.remove(); res(true); } });
    const cancel = el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => { m.remove(); res(false); } });
    m.append(el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, el('h3', { text: 'Sign in to the envelope service' }), el('p', { class: 'lead', text: message || 'Enter the admin token printed when the server started (also in data/admin-token.txt).' }), inp, el('div', { class: 'mfoot' }, cancel, ok)));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') cancel.click(); });
    document.body.append(m); inp.focus();
  });
}
export async function api(path, { method = 'GET', body, raw = false, admin = true } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = {}; if (body !== undefined) headers['content-type'] = 'application/json';
    if (admin) headers.authorization = 'Bearer ' + getToken();
    const r = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (r.status === 401 && admin) { const ok = await askToken(attempt ? 'That token was not accepted. Try again.' : undefined); if (!ok) throw new Error('Sign-in cancelled'); continue; }
    if (raw) { if (!r.ok) throw new Error(`Request failed (${r.status})`); return new Uint8Array(await r.arrayBuffer()); }
    let data = null; try { data = await r.json(); } catch {}
    if (!r.ok) { const err = new Error(data?.error || `Request failed (${r.status})`); err.status = r.status; err.data = data; throw err; }
    return data;
  }
  throw new Error('Not signed in');
}
export const b64 = bytes => { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };

// Envelopes: compose (place signer fields on the open PDF and send), the envelopes dashboard, and the
// signer page that a recipient opens from their link.
import { S, on, emit } from '../state.js';
import { $, el, toast, ICON, plural } from '../ui.js';
import { api, b64, served } from '../api.js';
import { buildPdf, outputName } from '../save.js';
import { fieldHooks, setTool, pushUndo, markDirty, renderAllObjs, fieldLabel } from '../editor.js';
import { ctxHooks, keyHooks } from '../hooks.js';
import { openBytes } from '../document.js';
import { place } from '../geometry.js';
import { openSig } from '../signature.js';
import { goTo } from '../viewer.js';

const SIZES = { signature: [180, 44], initials: [70, 30], date: [110, 22], text: [170, 22], checkbox: [16, 16] };
const TYPES = [['signature', 'Signature'], ['initials', 'Initials'], ['date', 'Date signed'], ['text', 'Text'], ['checkbox', 'Checkbox']];
const senderKey = 'pdfview.sender';
const C = { active: false, signers: [{ name: '', email: '' }], cur: 0, ftype: 'signature', required: true, title: '', message: '' };
const loadSender = () => { try { return JSON.parse(localStorage.getItem(senderKey) || '{}'); } catch { return {}; } };
const saveSender = s => { try { localStorage.setItem(senderKey, JSON.stringify(s)); } catch {} };
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/* ---------- compose ---------- */
function startCompose() {
  if (!S.doc || S.org || C.active) return;
  C.active = true; C.title = C.title || (S.name.replace(/\.pdf$/i, '') || 'Document');
  if (!C.signers.some(s => s.name || s.email)) openSignersModal(true); else { setTool('field'); emit('ctx'); }
}
function stopCompose(keepFields) {
  C.active = false;
  if (!keepFields && S.objects.some(o => o.type === 'field')) { pushUndo(); S.objects = S.objects.filter(o => o.type !== 'field'); renderAllObjs(); }
  setTool('select'); emit('ctx');
}
function makeField() {
  const s = C.signers[C.cur]; if (!s) return null;
  const [w, h] = SIZES[C.ftype];
  return { w, h, ftype: C.ftype, signer: C.cur, signerName: s.name || s.email || `Signer ${C.cur + 1}`, required: C.required && C.ftype !== 'checkbox', label: '' };
}
function renderComposeCtx(c) {
  c.append(el('span', { class: 'lbl', text: 'Send for signature' }));
  const bar = el('span', { class: 'sigbar' });
  C.signers.forEach((s, i) => bar.append(el('button', { type: 'button', class: 'signer-chip sc' + ((i % 5) + 1), 'aria-pressed': String(C.cur === i), text: s.name || s.email || `Signer ${i + 1}`, title: s.email, onclick: () => { C.cur = i; setTool('field'); emit('ctx'); } })));
  bar.append(el('button', { type: 'button', class: 'mini', text: 'Signers and message…', onclick: () => openSignersModal(false) }));
  c.append(bar, el('span', { class: 'sep' }));
  const sel = el('select', { class: 'ctl', 'aria-label': 'Field type' }); TYPES.forEach(([v, t]) => sel.append(el('option', { value: v, text: t }))); sel.value = C.ftype;
  sel.addEventListener('change', () => { C.ftype = sel.value; setTool('field'); });
  const req = el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: C.required }), el('span', { text: 'Required' })); req.querySelector('input').addEventListener('change', e => C.required = e.target.checked);
  c.append(el('span', { text: 'Place:' }), sel, req);
  const n = S.objects.filter(o => o.type === 'field').length;
  c.append(el('span', { class: 'sep' }), el('span', { text: n ? plural(n, 'field') + ' placed. Click a page to place another, drag to move.' : 'Click on the page where the signer should sign.' }));
  c.append(el('span', { class: 'grow' }), el('button', { type: 'button', class: 'mini', text: 'Cancel', onclick: () => stopCompose(false) }), el('button', { type: 'button', class: 'mini primary', id: 'envSend', text: 'Send…', disabled: !n, onclick: sendEnvelope }));
  return true;
}
function fieldCtx({ c, o }) {
  const sel = el('select', { class: 'ctl', 'aria-label': 'Signer' }); C.signers.forEach((s, i) => sel.append(el('option', { value: i, text: s.name || s.email || `Signer ${i + 1}` }))); sel.value = o.signer;
  sel.addEventListener('change', () => { pushUndo(); o.signer = +sel.value; o.signerName = C.signers[o.signer]?.name || C.signers[o.signer]?.email || ''; renderAllObjs(); markDirty(); });
  const req = el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: !!o.required }), el('span', { text: 'Required' })); req.querySelector('input').addEventListener('change', e => { o.required = e.target.checked; });
  c.append(el('span', { text: fieldLabel(o) }), sel, req);
}
let signersModal = null;
function openSignersModal(first) {
  if (signersModal) signersModal.remove();
  const sender = loadSender();
  const rows = el('div', { id: 'signerRows' });
  const addRow = (s, i) => {
    const r = el('div', { class: 'signer-row' }, el('span', { class: 'n', text: i + 1 }), el('input', { placeholder: 'Name', value: s.name }), el('input', { placeholder: 'Email', type: 'email', value: s.email }), el('button', { type: 'button', class: 'ib', title: 'Remove signer', html: ICON.del, onclick: () => { if (rows.children.length > 1) r.remove(); } }));
    rows.append(r);
  };
  C.signers.forEach(addRow);
  const title = el('input', { id: 'envTitle', value: C.title, placeholder: 'Envelope title' }), msg = el('textarea', { id: 'envMsg', text: C.message, placeholder: 'Message to the signers (optional)' });
  const sname = el('input', { id: 'envFromName', value: sender.name || '', placeholder: 'Your name' }), semail = el('input', { id: 'envFromEmail', value: sender.email || '', placeholder: 'Your email', type: 'email' });
  const m = el('div', { class: 'mback', id: 'envModal' }, el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    el('h3', { text: 'Signers and message' }),
    el('p', { class: 'lead', text: 'Signers sign one after another, in this order. Each gets a personal link by email, or you can copy the link yourself.' }),
    rows, el('button', { type: 'button', class: 'mini', id: 'envAddSigner', text: 'Add signer', onclick: () => addRow({ name: '', email: '' }, rows.children.length) }),
    el('h3', { text: 'Envelope' }), el('div', { class: 'frow' }, el('label', { text: 'Title' }), title), el('div', { class: 'frow' }, el('label', { text: 'Message' }), msg),
    el('div', { class: 'frow' }, el('label', { text: 'From' }), sname, semail),
    el('div', { class: 'mfoot' }, el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => { m.remove(); signersModal = null; if (first) stopCompose(false); else emit('ctx'); } }),
      el('button', { type: 'button', class: 'btn primary', id: 'envSignersOk', text: first ? 'Place fields' : 'Done', onclick: () => {
        const list = [...rows.children].map(r => ({ name: r.children[1].value.trim(), email: r.children[2].value.trim().toLowerCase() })).filter(s => s.name || s.email);
        if (!list.length) { toast('Add at least one signer.'); return; }
        const bad = list.find(s => !okEmail(s.email)); if (bad) { toast(`Enter a valid email for ${bad.name || 'each signer'}.`); return; }
        C.signers = list; C.cur = Math.min(C.cur, list.length - 1); C.title = title.value.trim() || C.title; C.message = msg.value.trim();
        saveSender({ name: sname.value.trim(), email: semail.value.trim() });
        S.objects.forEach(o => { if (o.type === 'field') { if (o.signer >= list.length) o.signer = 0; o.signerName = list[o.signer].name || list[o.signer].email; } });
        m.remove(); signersModal = null; renderAllObjs(); setTool('field'); emit('ctx');
      } }))));
  document.body.append(m); signersModal = m; rows.querySelector('input').focus();
}
async function sendEnvelope() {
  const fields = S.objects.filter(o => o.type === 'field'); if (!fields.length) { toast('Place at least one field.'); return; }
  const sender = loadSender(); if (!okEmail(sender.email || '')) { openSignersModal(false); toast('Enter your name and email under Signers and message.'); return; }
  const idle = C.signers.map((s, i) => fields.some(f => f.signer === i) ? null : s.name || s.email).filter(Boolean);
  if (idle.length && !confirm(`${idle.join(', ')} ${idle.length > 1 ? 'have' : 'has'} no fields to fill. Send anyway?`)) return;
  const btn = $('#envSend'); if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const { bytes } = await buildPdf({ editLayer: false }); // signers get a plain copy; nothing on it stays editable
    const payload = {
      title: C.title, message: C.message, sender: { name: sender.name, email: sender.email },
      documents: [{ name: outputName(false).replace(/-edited\.pdf$/, '.pdf'), data: b64(bytes) }],
      signers: C.signers,
      fields: fields.map(o => ({ doc: 0, signer: o.signer, page: S.pages.findIndex(p => p.uid === o.page), x: o.x, y: o.y, w: o.w, h: o.h, rot: o.a, type: o.ftype, required: !!o.required, label: o.label || '' }))
    };
    const env = await api('/api/envelopes', { method: 'POST', body: payload });
    const sent = await api(`/api/envelopes/${env.id}/send`, { method: 'POST' });
    stopCompose(false); S.dirty = false; $('#dirtyDot').hidden = true;
    showLinks(sent.envelope, sent.links);
  } catch (e) { console.error(e); toast('Could not send: ' + e.message); emit('ctx'); }
}
function showLinks(env, links) {
  const m = el('div', { class: 'mback', id: 'linksModal' });
  const list = el('div');
  for (const l of links) {
    const s = env.signers.find(x => x.id === l.signer_id);
    const inp = el('input', { class: 'signlink', value: l.url, readonly: true, style: { flex: 1 } });
    list.append(el('div', { class: 'signer-row' }, el('span', { text: s ? s.name || s.email : 'Signer' }), inp, el('button', { type: 'button', class: 'mini', text: 'Copy', onclick: async () => { try { await navigator.clipboard.writeText(l.url); toast('Link copied.'); } catch { inp.select(); } } })));
  }
  m.append(el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, el('h3', { text: 'Envelope sent' }),
    el('p', { class: 'lead', text: env.mail_configured ? 'The first signer has been emailed their link. You can also copy it here.' : 'Email is not configured on the server, so copy this link and send it to the signer yourself. Later signers get their link once the earlier ones have signed; find it under Envelopes.' }),
    list, el('div', { class: 'mfoot' }, el('button', { type: 'button', class: 'btn', text: 'Open Envelopes', onclick: () => { m.remove(); openPanel(env.id); } }), el('button', { type: 'button', class: 'btn primary', id: 'linksDone', text: 'Done', onclick: () => m.remove() }))));
  document.body.append(m);
}

/* ---------- dashboard ---------- */
let panelOpen = false, panelPrev = null;
function openPanel(id) {
  panelOpen = true; const p = $('#panel'); p.hidden = false; panelPrev = { sc: $('#scroller').hidden, org: $('#org').hidden }; $('#scroller').hidden = true; $('#org').hidden = true; $('#envBtn').setAttribute('aria-pressed', 'true');
  if (id) renderEnvelope(id); else renderList();
}
function closePanel() { if (!panelOpen) return; panelOpen = false; $('#panel').hidden = true; $('#scroller').hidden = panelPrev?.sc ?? false; $('#org').hidden = panelPrev?.org ?? true; $('#envBtn').setAttribute('aria-pressed', 'false'); }
const fmt = t => t ? new Date(t).toLocaleString() : '';
const pill = s => el('span', { class: 'pill ' + s, text: s });
async function renderList() {
  const p = $('#panel'); p.innerHTML = ''; const card = el('div', { class: 'card' }, el('div', { class: 'frow' }, el('h2', { text: 'Envelopes', style: { margin: 0 } }), el('span', { class: 'grow' }), el('button', { type: 'button', class: 'mini', text: 'Back to document', onclick: closePanel }))); p.append(card);
  let list; try { list = await api('/api/envelopes'); } catch (e) { card.append(el('p', { class: 'muted', text: 'Could not load envelopes: ' + e.message })); return; }
  if (!list.length) { card.append(el('p', { class: 'muted', text: 'No envelopes yet. Open a PDF and use Send to place signature fields and send it.' })); return; }
  const t = el('table', { class: 'list', id: 'envList' }, el('thead', {}, el('tr', {}, ...['Title', 'Status', 'Signers', 'Created', ''].map(h => el('th', { text: h })))));
  const tb = el('tbody'); t.append(tb);
  for (const e of list) tb.append(el('tr', {}, el('td', { text: e.title }), el('td', {}, pill(e.status)), el('td', { text: e.signers.map(s => `${s.name || s.email} (${s.status})`).join(', ') }), el('td', { text: fmt(e.created_at) }), el('td', {}, el('button', { type: 'button', class: 'mini', text: 'Open', onclick: () => renderEnvelope(e.id) }))));
  card.append(t);
}
async function renderEnvelope(id) {
  const p = $('#panel'); p.innerHTML = ''; let e;
  try { e = await api(`/api/envelopes/${id}`); } catch (err) { p.append(el('div', { class: 'card' }, el('p', { text: 'Could not load the envelope: ' + err.message }), el('button', { type: 'button', class: 'mini', text: 'Back', onclick: renderList }))); return; }
  const card = el('div', { class: 'card', id: 'envDetail', dataset: { status: e.status } });
  card.append(el('div', { class: 'frow' }, el('button', { type: 'button', class: 'ib', title: 'All envelopes', html: ICON.back, onclick: renderList }), el('h2', { text: e.title, style: { margin: 0 } }), pill(e.status), el('span', { class: 'grow' }), el('button', { type: 'button', class: 'mini', text: 'Back to document', onclick: closePanel })));
  card.append(el('p', { class: 'muted', text: `Created ${fmt(e.created_at)}${e.sent_at ? ' · sent ' + fmt(e.sent_at) : ''}${e.completed_at ? ' · completed ' + fmt(e.completed_at) : ''} · ${e.documents.map(d => `${d.name} (${plural(d.pages, 'page')})`).join(', ')}` }));
  const acts = el('div', { class: 'frow' });
  const dlCompleted = async () => { const bytes = await api(`/api/envelopes/${id}/completed.pdf`, { raw: true }); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); a.download = e.title.replace(/[^\w.-]+/g, '_') + '-completed.pdf'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  if (e.status === 'completed') acts.append(el('button', { type: 'button', class: 'mini primary', id: 'dlCompleted', text: 'Download completed PDF', onclick: () => dlCompleted().catch(err => toast(err.message)) }), el('button', { type: 'button', class: 'mini', text: 'Open completed PDF here', onclick: async () => { try { const bytes = await api(`/api/envelopes/${id}/completed.pdf`, { raw: true }); closePanel(); await openBytes(bytes, e.title + '-completed.pdf'); } catch (err) { toast(err.message); } } }));
  if (e.status === 'sent') acts.append(el('button', { type: 'button', class: 'mini', text: 'Send reminder', onclick: async () => { try { await api(`/api/envelopes/${id}/remind`, { method: 'POST' }); toast(e.mail_configured ? 'Reminder sent.' : 'Fresh link issued; use Get link below.'); renderEnvelope(id); } catch (err) { toast(err.message); } } }));
  if (e.status === 'sent' || e.status === 'draft') acts.append(el('button', { type: 'button', class: 'mini danger', text: 'Void envelope', onclick: async () => { if (!confirm('Void this envelope? Signing links stop working.')) return; try { await api(`/api/envelopes/${id}/void`, { method: 'POST' }); renderEnvelope(id); } catch (err) { toast(err.message); } } }));
  card.append(acts, el('h3', { text: 'Signers' }));
  const st = el('table', { class: 'list' }, el('thead', {}, el('tr', {}, ...['#', 'Name', 'Email', 'Status', 'Signed', 'Link'].map(h => el('th', { text: h })))));
  const stb = el('tbody'); st.append(stb);
  e.signers.forEach((s, i) => {
    const linkCell = el('td');
    const current = e.status === 'sent' && s.status !== 'signed' && e.signers.slice(0, i).every(x => x.status === 'signed');
    if (current) linkCell.append(el('button', { type: 'button', class: 'mini getlink', text: 'Get link', onclick: async () => { try { const r = await api(`/api/envelopes/${id}/signers/${s.id}/link`, { method: 'POST' }); const inp = el('input', { class: 'signlink', value: r.url, readonly: true, style: { width: '260px' } }); linkCell.innerHTML = ''; linkCell.append(inp, el('button', { type: 'button', class: 'mini', text: 'Copy', onclick: async () => { try { await navigator.clipboard.writeText(r.url); toast('Link copied.'); } catch { inp.select(); } } })); } catch (err) { toast(err.message); } } }));
    stb.append(el('tr', {}, el('td', { text: i + 1 }), el('td', { text: s.name }), el('td', { text: s.email }), el('td', {}, pill(s.status)), el('td', { text: fmt(s.signed_at) }), linkCell));
  });
  card.append(st, el('h3', { text: 'Audit trail' }));
  const et = el('table', { class: 'list', id: 'auditList' }, el('thead', {}, el('tr', {}, ...['Time', 'Event', 'Signer', 'IP address', 'Browser'].map(h => el('th', { text: h })))));
  const etb = el('tbody'); et.append(etb);
  for (const ev of e.events) { const s = e.signers.find(x => x.id === ev.signer_id); etb.append(el('tr', {}, el('td', { text: fmt(ev.at) }), el('td', { text: ev.type }), el('td', { text: s ? s.name || s.email : '' }), el('td', { text: ev.ip || '' }), el('td', { text: (ev.user_agent || '').slice(0, 60), title: ev.user_agent || '' }))); }
  card.append(et);
  if (e.completed_sha256) card.append(el('p', { class: 'muted', text: 'SHA-256 of the completed file: ' + e.completed_sha256 }));
  p.append(card);
}

/* ---------- signer page ---------- */
const G = { token: null, data: null, docIdx: 0, values: new Map(), consent: false, done: null };
const hasVal = v => v != null && v !== '' && v !== false;
function sigFieldsOn(p) {
  const d = G.data; if (!d) return [];
  const doc = d.documents[G.docIdx], idx = S.pages.indexOf(p);
  return [...d.fields.map(f => ({ f, mine: true })), ...(d.completed_fields || []).map(f => ({ f, mine: false }))].filter(x => x.f.document_id === doc.id && x.f.page === idx);
}
function renderSigFields(p) {
  if (S.mode !== 'sign' || !p.ol) return;
  for (const { f, mine } of sigFieldsOn(p)) {
    const val = mine ? G.values.get(f.id) : f.value;
    const d = el('div', { class: 'obj obj-sigfield' + (hasVal(val) ? ' done' : '') + (mine ? '' : ' other'), dataset: { fid: f.id, ftype: f.type }, title: mine ? (f.label || TYPES.find(t => t[0] === f.type)?.[1]) : 'Completed by another signer' });
    fillEl(d, f, val, mine);
    place(d, p, { x: f.x, y: f.y, w: f.w, h: f.h, a: f.rot });
    d.style.fontSize = Math.max(9, Math.min(14, f.h * S.scale * .55)) + 'px';
    if (mine) d.addEventListener('click', () => fillField(f, d));
    p.ol.append(d);
  }
}
function fillEl(d, f, val, mine) {
  d.innerHTML = '';
  if (hasVal(val)) {
    if (f.type === 'signature' || f.type === 'initials') d.append(el('img', { src: val, alt: f.type }));
    else if (f.type === 'checkbox') d.innerHTML = ICON.tick;
    else d.append(el('span', { text: String(val), style: { fontFamily: 'Helvetica, Arial, sans-serif', color: '#111' } }));
  } else d.append(el('span', { class: 'ph', text: !mine ? '' : { signature: 'Sign here', initials: 'Initial', date: 'Date', text: f.label || 'Type here', checkbox: '' }[f.type] + (f.required ? ' *' : '') }));
}
async function fillField(f, d) {
  if (f.type === 'signature' || f.type === 'initials') {
    const sig = await openSig(f.type === 'initials' ? 'Draw or type your initials' : 'Create your signature'); if (!sig) return;
    G.values.set(f.id, sig.url);
    for (const o of G.data.fields) if (o.type === f.type && !hasVal(G.values.get(o.id))) G.values.set(o.id, sig.url); // same signature for the other empty fields of that type
    renderAllObjs();
  } else if (f.type === 'date') { G.values.set(f.id, new Date().toISOString().slice(0, 10)); renderAllObjs(); }
  else if (f.type === 'checkbox') { G.values.set(f.id, !G.values.get(f.id)); renderAllObjs(); }
  else if (f.type === 'text') {
    if (d.querySelector('input')) return;
    const inp = el('input', { value: G.values.get(f.id) || '', placeholder: f.label || 'Type here' }); d.innerHTML = ''; d.append(inp); inp.focus();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); inp.blur(); } });
    inp.addEventListener('blur', () => { G.values.set(f.id, inp.value.trim()); renderAllObjs(); emit('ctx'); });
    return;
  }
  emit('ctx');
}
function progress() { const req = G.data.fields.filter(f => f.required), done = req.filter(f => hasVal(G.values.get(f.id))); return { req: req.length, done: done.length, missing: req.filter(f => !done.includes(f)) }; }
function renderSignCtx(c) {
  const d = G.data; if (!d) { c.append(el('span', { text: 'Loading…' })); return true; }
  c.append(el('span', { class: 'lbl', text: d.envelope.title }), el('span', { text: `from ${d.envelope.sender?.name || d.envelope.sender?.email || 'the sender'}` }));
  if (d.documents.length > 1) { c.append(el('span', { class: 'sep' })); d.documents.forEach((doc, i) => c.append(el('button', { type: 'button', class: 'mini', text: doc.name, 'aria-pressed': String(i === G.docIdx), disabled: i === G.docIdx, onclick: () => loadSignDoc(i) }))); }
  const pr = progress();
  c.append(el('span', { class: 'sep' }), el('span', { id: 'signProgress', text: pr.req ? `${pr.done} of ${pr.req} required fields completed` : 'Review the document, then finish.' }));
  const consent = el('label', { class: 'chk' }, el('input', { type: 'checkbox', id: 'consent', checked: G.consent }), el('span', { text: 'I agree to sign this document electronically and to receive records electronically.' }));
  consent.querySelector('input').addEventListener('change', e => { G.consent = e.target.checked; const fb = $('#finishBtn'), pr2 = progress(); if (fb) fb.disabled = !G.consent || pr2.done < pr2.req; });
  c.append(el('span', { class: 'grow' }), consent, el('button', { type: 'button', class: 'mini', id: 'declineBtn', text: 'Decline', onclick: declineSign }), el('button', { type: 'button', class: 'mini primary', id: 'finishBtn', text: 'Finish signing', disabled: !G.consent || pr.done < pr.req, onclick: finishSign }));
  return true;
}
async function loadSignDoc(i) {
  G.docIdx = i; const doc = G.data.documents[i];
  const bytes = await api(`/api/sign/${G.token}/documents/${doc.id}.pdf`, { raw: true, admin: false });
  await openBytes(bytes, doc.name, { quiet: true }); emit('ctx');
}
function doneCard(title, text) { $('#scroller').hidden = true; const p = $('#panel'); p.hidden = false; p.innerHTML = ''; p.append(el('div', { class: 'done-card', id: 'doneCard' }, el('div', { html: ICON.tick }), el('h2', { text: title }), el('p', { class: 'muted', text }))); $('#ctx').innerHTML = ''; }
async function finishSign() {
  const pr = progress(); if (pr.missing.length) { const f = pr.missing[0]; toast('Complete the required fields first.'); const i = G.data.documents.findIndex(d => d.id === f.document_id); if (i !== G.docIdx) await loadSignDoc(i); goTo(f.page + 1); return; }
  if (!G.consent) { toast('Please agree to sign electronically first.'); return; }
  const fields = G.data.fields.map(f => ({ id: f.id, value: G.values.has(f.id) ? G.values.get(f.id) : (f.type === 'date' ? new Date().toISOString().slice(0, 10) : f.type === 'checkbox' ? false : '') }));
  try {
    const r = await api(`/api/sign/${G.token}`, { method: 'POST', body: { consent: true, fields }, admin: false });
    G.done = r.status;
    doneCard('Thank you, your signature was recorded', r.status === 'completed' ? 'Everyone has signed. The completed document will be emailed to you if the sender has email set up; otherwise the sender will send it to you.' : `The document now goes to ${r.next_signer?.name || 'the next signer'}. You will receive the completed copy once everyone has signed.`);
  } catch (e) { toast('Could not submit: ' + e.message); }
}
async function declineSign() {
  const reason = prompt('Tell the sender why you are declining (optional):'); if (reason === null) return;
  try { await api(`/api/sign/${G.token}/decline`, { method: 'POST', body: { reason }, admin: false }); doneCard('You declined to sign', 'The sender has been notified.'); } catch (e) { toast('Could not decline: ' + e.message); }
}
export async function startSigner(token) {
  S.mode = 'sign'; document.body.dataset.mode = 'sign'; G.token = token; emit('ctx');
  try { G.data = await api(`/api/sign/${token}`, { admin: false }); }
  catch (e) {
    const msg = e.status === 409 ? (e.data?.status === 'signed' ? 'You have already signed this document.' : 'This document was declined.') : 'This signing link is not valid any more. It may have expired, been replaced with a newer link, or the envelope may have been voided. Ask the sender for a new link.';
    doneCard('This link cannot be used', msg); return;
  }
  await loadSignDoc(0);
}

export function init() {
  on('objs:rendered', renderSigFields);
  const prev = ctxHooks.render; ctxHooks.render = c => (S.mode === 'sign' && renderSignCtx(c)) || (C.active && !S.org && renderComposeCtx(c)) || (prev ? prev(c) : false);
  on('ctx:field', fieldCtx);
  fieldHooks.make = makeField;
  if (!served()) { $('#sendBtn').hidden = true; $('#envBtn').hidden = true; return; }
  $('#sendBtn').addEventListener('click', () => { if (C.active) { setTool('field'); emit('ctx'); } else startCompose(); });
  $('#envBtn').addEventListener('click', () => panelOpen ? closePanel() : openPanel());
  on('doc:open', () => { if (S.mode !== 'sign') { closePanel(); C.active = false; } });
  on('doc:close', () => { C.active = false; });
  keyHooks.push((e) => { if (panelOpen) { if (e.key === 'Escape') closePanel(); return !(e.ctrlKey || e.metaKey); } if (C.active && e.key === 'Escape' && S.sel == null && S.tool === 'select') { stopCompose(false); return true; } return false; });
}

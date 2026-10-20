import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { HttpError, id, sha256, nowIso, newToken, hashToken, isEmail, str } from './util.js';
import { signingRequestMail, completionMail } from './mail.js';
import { buildCompleted } from './complete.js';

const FIELD_TYPES = new Set(['signature', 'initials', 'date', 'text', 'checkbox']);
const TOKEN_DAYS = 30;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export function createService({ db, dataDir, mailer, baseUrl, maxPdfBytes }) {
  const docsDir = join(dataDir, 'docs'), doneDir = join(dataDir, 'completed');
  mkdirSync(docsDir, { recursive: true });
  mkdirSync(doneDir, { recursive: true });

  const docPath = docId => join(docsDir, `${docId}.pdf`);
  const donePath = envId => join(doneDir, `${envId}.pdf`);

  function event(envelope_id, type, info, signer_id = null, details = {}) {
    db.run('INSERT INTO events (envelope_id, signer_id, type, at, ip, user_agent, details) VALUES (?,?,?,?,?,?,?)',
      envelope_id, signer_id, type, nowIso(), info?.ip || '', info?.user_agent || '', JSON.stringify(details));
  }

  const rowEnvelope = eid => db.get('SELECT * FROM envelopes WHERE id = ?', eid);
  const rowDocs = eid => db.all('SELECT * FROM documents WHERE envelope_id = ? ORDER BY idx', eid);
  const rowSigners = eid => db.all('SELECT * FROM signers WHERE envelope_id = ? ORDER BY idx', eid);
  const rowFields = eid => db.all('SELECT * FROM fields WHERE envelope_id = ? ORDER BY rowid', eid);
  const rowEvents = eid => db.all('SELECT * FROM events WHERE envelope_id = ? ORDER BY id', eid);

  const pubSigner = s => ({ id: s.id, idx: s.idx, name: s.name, email: s.email, status: s.status, signed_at: s.signed_at });
  const pubDoc = d => ({ id: d.id, idx: d.idx, name: d.name, pages: d.pages, sha256: d.sha256 });
  const pubField = f => ({
    id: f.id, document_id: f.document_id, signer_id: f.signer_id, page: f.page,
    x: f.x, y: f.y, w: f.w, h: f.h, rot: f.rot, type: f.type, required: !!f.required, label: f.label,
    value: f.value == null ? null : JSON.parse(f.value)
  });
  const pubEvent = e => ({ type: e.type, at: e.at, signer_id: e.signer_id, ip: e.ip, user_agent: e.user_agent, details: JSON.parse(e.details || '{}') });

  function full(eid) {
    const e = rowEnvelope(eid);
    if (!e) throw new HttpError(404, 'Envelope not found');
    return {
      id: e.id, title: e.title, message: e.message, status: e.status,
      sender: { name: e.sender_name, email: e.sender_email },
      created_at: e.created_at, sent_at: e.sent_at, completed_at: e.completed_at, completed_sha256: e.completed_sha256,
      documents: rowDocs(eid).map(pubDoc),
      signers: rowSigners(eid).map(pubSigner),
      fields: rowFields(eid).map(pubField),
      events: rowEvents(eid).map(pubEvent),
      mail_configured: mailer.configured
    };
  }

  function currentSigner(eid) {
    return rowSigners(eid).find(s => s.status !== 'signed' && s.status !== 'declined') || null;
  }

  function issueToken(signer, info) {
    const token = newToken();
    const expires = new Date(Date.now() + TOKEN_DAYS * 864e5).toISOString();
    db.run('UPDATE signers SET token_hash = ?, token_expires_at = ?, status = CASE WHEN status = ? THEN ? ELSE status END WHERE id = ?',
      hashToken(token), expires, 'pending', 'sent', signer.id);
    event(signer.envelope_id, 'link_issued', info, signer.id, { expires_at: expires });
    return `${baseUrl}/sign/${token}`;
  }

  async function mailSigner(env, signer, url) {
    const m = signingRequestMail({ senderName: env.sender_name, title: env.title, message: env.message, url });
    try { await mailer.send({ to: signer.email, replyTo: env.sender_email, ...m }); } catch (e) { console.error('mail failed', e.message); }
  }

  async function createEnvelope(body, info) {
    const title = str(body.title, 200).trim();
    if (!title) throw new HttpError(400, 'title is required');
    const sender = body.sender || {};
    const docs = Array.isArray(body.documents) ? body.documents : [];
    const signers = Array.isArray(body.signers) ? body.signers : [];
    const fields = Array.isArray(body.fields) ? body.fields : [];
    if (!docs.length) throw new HttpError(400, 'at least one document is required');
    if (!signers.length) throw new HttpError(400, 'at least one signer is required');
    for (const s of signers) if (!isEmail(s?.email)) throw new HttpError(400, `signer email is not valid: ${str(s?.email, 80)}`);

    const parsed = [];
    for (const d of docs) {
      let bytes;
      try { bytes = Buffer.from(String(d?.data || ''), 'base64'); } catch { bytes = Buffer.alloc(0); }
      if (bytes.length < 5 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, `${str(d?.name, 80) || 'document'} is not a PDF`);
      if (bytes.length > maxPdfBytes) throw new HttpError(413, `${str(d?.name, 80) || 'document'} is larger than the allowed size`);
      let pages;
      try { pages = (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).getPageCount(); }
      catch { throw new HttpError(400, `${str(d?.name, 80) || 'document'} could not be parsed`); }
      parsed.push({ id: id(), name: str(d.name, 200) || 'document.pdf', bytes, pages, sha256: sha256(bytes) });
    }
    for (const f of fields) {
      const doc = parsed[f?.doc];
      if (!doc) throw new HttpError(400, 'field references a document that does not exist');
      if (!signers[f?.signer]) throw new HttpError(400, 'field references a signer that does not exist');
      if (!FIELD_TYPES.has(f?.type)) throw new HttpError(400, `field type is not supported: ${str(f?.type, 40)}`);
      if (!Number.isInteger(f.page) || f.page < 0 || f.page >= doc.pages) throw new HttpError(400, 'field page is out of range');
      for (const k of ['x', 'y', 'w', 'h']) if (typeof f[k] !== 'number' || !Number.isFinite(f[k])) throw new HttpError(400, `field ${k} must be a number`);
      if (f.w <= 0 || f.h <= 0) throw new HttpError(400, 'field size must be positive');
    }

    const eid = id();
    db.tx(() => {
      db.run('INSERT INTO envelopes (id, title, message, status, sender_name, sender_email, created_at) VALUES (?,?,?,?,?,?,?)',
        eid, title, str(body.message, 4000), 'draft', str(sender.name, 200), str(sender.email, 254), nowIso());
      parsed.forEach((d, i) => {
        writeFileSync(docPath(d.id), d.bytes);
        db.run('INSERT INTO documents (id, envelope_id, idx, name, pages, sha256) VALUES (?,?,?,?,?,?)', d.id, eid, i, d.name, d.pages, d.sha256);
      });
      const sids = signers.map((s, i) => {
        const sid = id();
        db.run('INSERT INTO signers (id, envelope_id, idx, name, email, status) VALUES (?,?,?,?,?,?)', sid, eid, i, str(s.name, 200) || s.email, String(s.email).trim(), 'pending');
        return sid;
      });
      for (const f of fields) {
        db.run('INSERT INTO fields (id, envelope_id, document_id, signer_id, page, x, y, w, h, rot, type, required, label) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          id(), eid, parsed[f.doc].id, sids[f.signer], f.page, f.x, f.y, f.w, f.h, [0, 90, 180, 270].includes(f.rot) ? f.rot : 0, f.type, f.required === false ? 0 : 1, str(f.label, 200));
      }
      event(eid, 'created', info, null, { documents: parsed.length, signers: signers.length, fields: fields.length });
    });
    return full(eid);
  }

  function listEnvelopes() {
    return db.all('SELECT * FROM envelopes ORDER BY created_at DESC, rowid DESC').map(e => ({
      id: e.id, title: e.title, status: e.status, created_at: e.created_at, sent_at: e.sent_at, completed_at: e.completed_at,
      signers: rowSigners(e.id).map(s => ({ name: s.name, email: s.email, status: s.status })),
      documents: rowDocs(e.id).map(d => ({ name: d.name, pages: d.pages }))
    }));
  }

  async function sendEnvelope(eid, info) {
    const e = rowEnvelope(eid);
    if (!e) throw new HttpError(404, 'Envelope not found');
    if (e.status !== 'draft') throw new HttpError(409, `Envelope is ${e.status}, only drafts can be sent`);
    db.run('UPDATE envelopes SET status = ?, sent_at = ? WHERE id = ?', 'sent', nowIso(), eid);
    event(eid, 'sent', info);
    const first = currentSigner(eid);
    const url = issueToken(first, info);
    await mailSigner(e, first, url);
    return { envelope: full(eid), links: [{ signer_id: first.id, url }] };
  }

  function issueLink(eid, signerId, info) {
    const e = rowEnvelope(eid);
    if (!e) throw new HttpError(404, 'Envelope not found');
    if (e.status !== 'sent') throw new HttpError(409, `Envelope is ${e.status}`);
    const cur = currentSigner(eid);
    if (!cur || cur.id !== signerId) throw new HttpError(409, 'That signer is not the current signer');
    return { url: issueToken(cur, info) };
  }

  async function remind(eid, info) {
    const e = rowEnvelope(eid);
    if (!e) throw new HttpError(404, 'Envelope not found');
    if (e.status !== 'sent') throw new HttpError(409, `Envelope is ${e.status}`);
    const cur = currentSigner(eid);
    const url = issueToken(cur, info);
    await mailSigner(e, cur, url);
    event(eid, 'reminded', info, cur.id);
    return { links: [{ signer_id: cur.id, url }] };
  }

  function voidEnvelope(eid, info) {
    const e = rowEnvelope(eid);
    if (!e) throw new HttpError(404, 'Envelope not found');
    if (e.status !== 'draft' && e.status !== 'sent') throw new HttpError(409, `Envelope is ${e.status}`);
    db.tx(() => {
      db.run('UPDATE envelopes SET status = ? WHERE id = ?', 'voided', eid);
      db.run('UPDATE signers SET token_hash = NULL, token_expires_at = NULL WHERE envelope_id = ?', eid);
      event(eid, 'voided', info);
    });
    return full(eid);
  }

  function documentBytes(eid, docId) {
    const d = db.get('SELECT * FROM documents WHERE id = ? AND envelope_id = ?', docId, eid);
    if (!d || !existsSync(docPath(d.id))) throw new HttpError(404, 'Document not found');
    return readFileSync(docPath(d.id));
  }

  function completedBytes(eid) {
    const e = rowEnvelope(eid);
    if (!e) throw new HttpError(404, 'Envelope not found');
    if (e.status !== 'completed' || !existsSync(donePath(eid))) throw new HttpError(404, 'Envelope is not completed');
    return readFileSync(donePath(eid));
  }

  function audit(eid) {
    const e = full(eid);
    return {
      envelope_id: e.id, title: e.title, status: e.status,
      documents: e.documents.map(d => ({ name: d.name, sha256: d.sha256 })),
      completed_sha256: e.completed_sha256, signers: e.signers, events: e.events
    };
  }

  // Signer side. Returns the signer row and envelope for a live token, or throws per API.md.
  function resolveToken(token) {
    const s = db.get('SELECT * FROM signers WHERE token_hash = ?', hashToken(token));
    if (!s || !s.token_expires_at || s.token_expires_at < nowIso()) throw new HttpError(404, 'This signing link is not valid');
    const e = rowEnvelope(s.envelope_id);
    if (!e || e.status === 'voided' || e.status === 'draft') throw new HttpError(404, 'This signing link is not valid');
    if (s.status === 'signed' || s.status === 'declined' || e.status === 'completed' || e.status === 'declined') {
      throw new HttpError(409, `This envelope is already ${s.status === 'signed' ? 'signed' : s.status === 'declined' ? 'declined' : e.status}`, { status: s.status === 'pending' || s.status === 'sent' || s.status === 'viewed' ? e.status : s.status });
    }
    return { s, e };
  }

  function signerView(token, info) {
    const { s, e } = resolveToken(token);
    if (!s.viewed) {
      db.run('UPDATE signers SET viewed = 1, status = ? WHERE id = ?', 'viewed', s.id);
      event(e.id, 'viewed', info, s.id);
    }
    const fields = rowFields(e.id).map(pubField);
    const mine = fields.filter(f => f.signer_id === s.id).map(f => ({ ...f, value: null }));
    const others = fields.filter(f => f.signer_id !== s.id && f.value != null);
    return {
      envelope: { id: e.id, title: e.title, message: e.message, sender: { name: e.sender_name, email: e.sender_email } },
      signer: { id: s.id, name: s.name, email: s.email },
      documents: rowDocs(e.id).map(d => ({ id: d.id, idx: d.idx, name: d.name, pages: d.pages })),
      fields: mine,
      completed_fields: others
    };
  }

  function signerDocument(token, docId) {
    const { e } = resolveToken(token);
    return documentBytes(e.id, docId);
  }

  function validValue(type, v) {
    if (type === 'signature' || type === 'initials') {
      if (typeof v !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v)) return false;
      return v.length <= MAX_IMAGE_BYTES * 1.4;
    }
    if (type === 'checkbox') return typeof v === 'boolean';
    return typeof v === 'string' && v.length <= 2000;
  }

  async function submitSign(token, body, info) {
    const { s, e } = resolveToken(token);
    if (body?.consent !== true) throw new HttpError(400, 'Consent to use electronic records and signatures is required');
    const mine = rowFields(e.id).filter(f => f.signer_id === s.id);
    const byId = new Map(mine.map(f => [f.id, f]));
    const given = new Map();
    for (const item of Array.isArray(body.fields) ? body.fields : []) {
      const f = byId.get(item?.id);
      if (!f) throw new HttpError(400, 'A field does not belong to this signer');
      if (item.value == null || item.value === '' || item.value === false) continue;
      if (!validValue(f.type, item.value)) throw new HttpError(400, `The value for "${f.label || f.type}" is not acceptable`);
      given.set(f.id, item.value);
    }
    const today = nowIso().slice(0, 10);
    for (const f of mine) {
      if (!given.has(f.id) && f.type === 'date') given.set(f.id, today);
      if (f.required && !given.has(f.id)) throw new HttpError(400, `"${f.label || f.type}" is required`);
    }
    const at = nowIso();
    db.tx(() => {
      for (const [fid, v] of given) db.run('UPDATE fields SET value = ? WHERE id = ?', JSON.stringify(v), fid);
      event(e.id, 'consented', info, s.id, { text: 'Agreed to use electronic records and signatures' });
      db.run('UPDATE signers SET status = ?, signed_at = ?, signed_ip = ?, token_hash = NULL, token_expires_at = NULL WHERE id = ?', 'signed', at, info.ip || '', s.id);
      event(e.id, 'signed', info, s.id, { fields: mine.filter(f => given.has(f.id)).map(f => ({ id: f.id, type: f.type })) });
    });
    const next = currentSigner(e.id);
    if (next) {
      const url = issueToken(next, info);
      await mailSigner(e, next, url);
      return { status: 'sent', next_signer: { name: next.name } };
    }
    await complete(e.id, info);
    return { status: 'completed' };
  }

  async function complete(eid, info) {
    const data = full(eid);
    data.completed_at = nowIso();
    const bytes = Buffer.from(await buildCompleted(data, d => readFileSync(docPath(d.id))));
    writeFileSync(donePath(eid), bytes);
    const hash = sha256(bytes);
    db.run('UPDATE envelopes SET status = ?, completed_at = ?, completed_sha256 = ? WHERE id = ?', 'completed', data.completed_at, hash, eid);
    event(eid, 'completed', info, null, { sha256: hash, bytes: bytes.length });
    const m = completionMail({ title: data.title, envelopeId: eid });
    const recipients = [...data.signers.map(s => s.email), data.sender.email].filter(isEmail);
    for (const to of new Set(recipients)) {
      try { await mailer.send({ to, replyTo: data.sender?.email, ...m, attachments: [{ filename: `${safeName(data.title)}-completed.pdf`, content: bytes }] }); }
      catch (err) { console.error('mail failed', err.message); }
    }
  }

  function decline(token, body, info) {
    const { s, e } = resolveToken(token);
    const reason = str(body?.reason, 1000);
    db.tx(() => {
      db.run('UPDATE signers SET status = ?, token_hash = NULL, token_expires_at = NULL WHERE id = ?', 'declined', s.id);
      db.run('UPDATE envelopes SET status = ? WHERE id = ?', 'declined', e.id);
      event(e.id, 'declined', info, s.id, { reason });
    });
    return { status: 'declined' };
  }

  return { createEnvelope, listEnvelopes, full, sendEnvelope, issueLink, remind, voidEnvelope, documentBytes, completedBytes, audit, signerView, signerDocument, submitSign, decline };
}

const safeName = t => (String(t).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'envelope').slice(0, 60);

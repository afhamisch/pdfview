import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN = 'test';
let proc, base, dataDir;

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function makePdf() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) { const p = d.addPage([612, 792]); p.drawText(`Test page ${i}`, { x: 72, y: 720, size: 18, font: f }); }
  return Buffer.from(await d.save()).toString('base64');
}

const admin = (path, opts = {}) => fetch(base + path, { ...opts, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(opts.headers || {}) } });
const post = (path, body, headers) => admin(path, { method: 'POST', body: JSON.stringify(body), headers });
const signer = (path, opts = {}) => fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'pdfview-test-'));
  proc = spawn(process.execPath, [join(here, '..', 'src', 'index.js')], {
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ADMIN_TOKEN: TOKEN, BASE_URL: 'http://localhost', SMTP_URL: '', APP_DIST: join(dataDir, 'no-app') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const port = await new Promise((res, rej) => {
    let out = '';
    proc.stdout.on('data', c => { out += c; const m = /listening (\d+)/.exec(out); if (m) res(Number(m[1])); });
    proc.stderr.on('data', c => { const s = String(c); if (!/ExperimentalWarning|trace-warnings/.test(s)) process.stderr.write(s); });
    proc.on('exit', code => rej(new Error('server exited ' + code)));
    setTimeout(() => rej(new Error('server did not start')), 15000);
  });
  base = `http://127.0.0.1:${port}`;
});

after(() => { proc?.kill(); rmSync(dataDir, { recursive: true, force: true }); });

let env, docId, signerIds, link1;

test('admin routes reject a missing token', async () => {
  const r = await fetch(base + '/api/envelopes');
  assert.equal(r.status, 401);
});

test('static route reports a missing app build', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 503);
});

test('create an envelope with two signers and fields', async () => {
  const data = await makePdf();
  const r = await post('/api/envelopes', {
    title: 'Retainer: Test', message: 'Please sign.', sender: { name: 'Alan', email: 'alan@example.com' },
    documents: [{ name: 'retainer.pdf', data }],
    signers: [{ name: 'Jane Smith', email: 'jane@example.com' }, { name: 'John Doe', email: 'john@example.com' }],
    fields: [
      { doc: 0, signer: 0, page: 0, x: 72, y: 300, w: 180, h: 40, rot: 0, type: 'signature', required: true, label: 'Client signature' },
      { doc: 0, signer: 0, page: 0, x: 300, y: 300, w: 120, h: 20, rot: 0, type: 'date', required: true, label: 'Date' },
      { doc: 0, signer: 0, page: 1, x: 72, y: 500, w: 14, h: 14, rot: 0, type: 'checkbox', required: false, label: 'Agree' },
      { doc: 0, signer: 1, page: 1, x: 72, y: 300, w: 180, h: 40, rot: 0, type: 'initials', required: true, label: 'Initials' }
    ]
  });
  assert.equal(r.status, 201);
  env = await r.json();
  assert.equal(env.status, 'draft');
  assert.equal(env.documents[0].pages, 2);
  assert.equal(env.fields.length, 4);
  assert.equal(env.events[0].type, 'created');
  assert.equal(env.mail_configured, false);
  docId = env.documents[0].id;
  signerIds = env.signers.map(s => s.id);
});

test('validation rejects a non-PDF and a bad field', async () => {
  let r = await post('/api/envelopes', { title: 'x', documents: [{ name: 'a.pdf', data: Buffer.from('hello').toString('base64') }], signers: [{ email: 'a@b.co' }] });
  assert.equal(r.status, 400);
  const data = await makePdf();
  r = await post('/api/envelopes', { title: 'x', documents: [{ name: 'a.pdf', data }], signers: [{ email: 'a@b.co' }], fields: [{ doc: 0, signer: 0, page: 5, x: 1, y: 1, w: 1, h: 1, type: 'text' }] });
  assert.equal(r.status, 400);
  r = await post('/api/envelopes', { title: 'x', documents: [{ name: 'a.pdf', data }], signers: [{ email: 'not-an-email' }] });
  assert.equal(r.status, 400);
});

test('list and get', async () => {
  const list = await (await admin('/api/envelopes')).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].signers.length, 2);
  const one = await (await admin(`/api/envelopes/${env.id}`)).json();
  assert.equal(one.title, 'Retainer: Test');
  const doc = await admin(`/api/envelopes/${env.id}/documents/${docId}.pdf`);
  assert.equal(doc.headers.get('content-type'), 'application/pdf');
});

test('send issues a link for the first signer', async () => {
  const r = await post(`/api/envelopes/${env.id}/send`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.envelope.status, 'sent');
  assert.equal(body.links.length, 1);
  assert.equal(body.links[0].signer_id, signerIds[0]);
  assert.match(body.links[0].url, /^http:\/\/localhost\/sign\/[A-Za-z0-9_-]{40,}$/);
  link1 = body.links[0].url.split('/sign/')[1];
  const again = await post(`/api/envelopes/${env.id}/send`);
  assert.equal(again.status, 409);
});

test('a fresh link replaces the old one', async () => {
  const r = await post(`/api/envelopes/${env.id}/signers/${signerIds[0]}/link`);
  assert.equal(r.status, 200);
  const { url } = await r.json();
  const old = await signer(`/api/sign/${link1}`);
  assert.equal(old.status, 404);
  link1 = url.split('/sign/')[1];
  const wrong = await post(`/api/envelopes/${env.id}/signers/${signerIds[1]}/link`);
  assert.equal(wrong.status, 409);
});

test('bad signer token is 404', async () => {
  const r = await signer('/api/sign/' + 'x'.repeat(43));
  assert.equal(r.status, 404);
});

test('signer view records a viewed event and shows only that signer\'s fields', async () => {
  const r = await signer(`/api/sign/${link1}`);
  assert.equal(r.status, 200);
  const v = await r.json();
  assert.equal(v.signer.id, signerIds[0]);
  assert.equal(v.fields.length, 3);
  assert.equal(v.completed_fields.length, 0);
  assert.equal(v.documents[0].pages, 2);
  const doc = await signer(`/api/sign/${link1}/documents/${docId}.pdf`);
  assert.equal(doc.headers.get('content-type'), 'application/pdf');
  const one = await (await admin(`/api/envelopes/${env.id}`)).json();
  assert.equal(one.signers[0].status, 'viewed');
  assert.ok(one.events.some(e => e.type === 'viewed' && e.signer_id === signerIds[0]));
});

test('signing without consent is rejected', async () => {
  const v = await (await signer(`/api/sign/${link1}`)).json();
  const sig = v.fields.find(f => f.type === 'signature');
  const r = await signer(`/api/sign/${link1}`, { method: 'POST', body: JSON.stringify({ consent: false, fields: [{ id: sig.id, value: PNG_1x1 }] }) });
  assert.equal(r.status, 400);
  const missing = await signer(`/api/sign/${link1}`, { method: 'POST', body: JSON.stringify({ consent: true, fields: [] }) });
  assert.equal(missing.status, 400);
});

let link2;
test('first signer signs, second signer is issued a link', async () => {
  const v = await (await signer(`/api/sign/${link1}`)).json();
  const sig = v.fields.find(f => f.type === 'signature');
  const cb = v.fields.find(f => f.type === 'checkbox');
  const r = await signer(`/api/sign/${link1}`, { method: 'POST', body: JSON.stringify({ consent: true, fields: [{ id: sig.id, value: PNG_1x1 }, { id: cb.id, value: true }] }) });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, 'sent');
  assert.equal(body.next_signer.name, 'John Doe');
  const reused = await signer(`/api/sign/${link1}`);
  assert.equal(reused.status, 404);
  const one = await (await admin(`/api/envelopes/${env.id}`)).json();
  assert.equal(one.signers[0].status, 'signed');
  assert.equal(one.signers[1].status, 'sent');
  const dateField = one.fields.find(f => f.type === 'date');
  assert.match(dateField.value, /^\d{4}-\d{2}-\d{2}$/);
  const rem = await post(`/api/envelopes/${env.id}/remind`);
  assert.equal(rem.status, 200);
  link2 = (await rem.json()).links[0].url.split('/sign/')[1];
});

test('second signer sees completed fields, signs, envelope completes', async () => {
  const v = await (await signer(`/api/sign/${link2}`)).json();
  assert.equal(v.signer.id, signerIds[1]);
  assert.equal(v.fields.length, 1);
  assert.equal(v.completed_fields.length, 3);
  const r = await signer(`/api/sign/${link2}`, { method: 'POST', body: JSON.stringify({ consent: true, fields: [{ id: v.fields[0].id, value: PNG_1x1 }] }) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, 'completed');
  const one = await (await admin(`/api/envelopes/${env.id}`)).json();
  assert.equal(one.status, 'completed');
  assert.match(one.completed_sha256, /^[a-f0-9]{64}$/);
});

test('completed.pdf has the pages plus a certificate and the audit lists events in order', async () => {
  const r = await admin(`/api/envelopes/${env.id}/completed.pdf`);
  assert.equal(r.status, 200);
  const bytes = Buffer.from(await r.arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 3);
  const audit = await (await admin(`/api/envelopes/${env.id}/audit`)).json();
  const types = audit.events.map(e => e.type);
  const expect = ['created', 'sent', 'link_issued', 'link_issued', 'viewed', 'consented', 'signed', 'link_issued', 'link_issued', 'reminded', 'viewed', 'consented', 'signed', 'completed'];
  assert.deepEqual(types, expect);
  assert.equal(audit.completed_sha256.length, 64);
  const closed = await signer(`/api/sign/${link2}`);
  assert.equal(closed.status, 404);
});

test('decline path', async () => {
  const data = await makePdf();
  const e = await (await post('/api/envelopes', { title: 'Decline me', documents: [{ name: 'a.pdf', data }], signers: [{ name: 'D', email: 'd@example.com' }], fields: [{ doc: 0, signer: 0, page: 0, x: 1, y: 100, w: 100, h: 30, type: 'signature' }] })).json();
  const sent = await (await post(`/api/envelopes/${e.id}/send`)).json();
  const tok = sent.links[0].url.split('/sign/')[1];
  const r = await signer(`/api/sign/${tok}/decline`, { method: 'POST', body: JSON.stringify({ reason: 'Wrong amount' }) });
  assert.equal(r.status, 200);
  const one = await (await admin(`/api/envelopes/${e.id}`)).json();
  assert.equal(one.status, 'declined');
  assert.equal(one.signers[0].status, 'declined');
  assert.equal(one.events.at(-1).details.reason, 'Wrong amount');
  const after = await signer(`/api/sign/${tok}`);
  assert.equal(after.status, 404);
});

test('void path', async () => {
  const data = await makePdf();
  const e = await (await post('/api/envelopes', { title: 'Void me', documents: [{ name: 'a.pdf', data }], signers: [{ name: 'V', email: 'v@example.com' }] })).json();
  const sent = await (await post(`/api/envelopes/${e.id}/send`)).json();
  const tok = sent.links[0].url.split('/sign/')[1];
  const r = await post(`/api/envelopes/${e.id}/void`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, 'voided');
  assert.equal((await signer(`/api/sign/${tok}`)).status, 404);
  assert.equal((await post(`/api/envelopes/${e.id}/void`)).status, 409);
  assert.equal((await admin(`/api/envelopes/${e.id}/completed.pdf`)).status, 404);
});

test('signer routes are rate limited', async () => {
  let got429 = false, last = 0;
  for (let i = 0; i < 61; i++) {
    last = (await signer('/api/sign/' + 'y'.repeat(43))).status;
    if (last === 429) got429 = true;
  }
  assert.ok(got429);
  assert.equal(last, 429);
});

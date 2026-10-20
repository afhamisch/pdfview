import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDb } from './db.js';
import { createMailer } from './mail.js';
import { createService } from './envelopes.js';
import { HttpError, readJson, sendJson, safeEqual, requestInfo } from './util.js';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT ?? 8787);
const DATA_DIR = resolve(env.DATA_DIR || join(here, '..', 'data'));
const BASE_URL = (env.BASE_URL || `http://localhost:${PORT || 8787}`).replace(/\/+$/, '');
const APP_DIST = resolve(env.APP_DIST || join(here, '..', '..', 'app', 'dist'));
const MAX_PDF_BYTES = Math.max(1, Number(env.MAX_PDF_MB || 50)) * 1024 * 1024;
const BODY_CAP = 80 * 1024 * 1024;
const RATE_LIMIT = 60, RATE_WINDOW_MS = 60_000;

mkdirSync(DATA_DIR, { recursive: true });
let ADMIN_TOKEN = env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  // keep the same token across restarts so saved sign-ins keep working
  const tokenFile = join(DATA_DIR, 'admin-token.txt');
  try { ADMIN_TOKEN = readFileSync(tokenFile, 'utf8').trim(); } catch { ADMIN_TOKEN = ''; }
  if (!ADMIN_TOKEN) { ADMIN_TOKEN = randomBytes(24).toString('base64url'); writeFileSync(tokenFile, ADMIN_TOKEN + '\n', { mode: 0o600 }); }
  console.log(`\n==========================================================\n  Admin token (paste it when the app asks for it):\n  ${ADMIN_TOKEN}\n  Also saved in ${tokenFile}\n==========================================================\n`);
}

const db = openDb(DATA_DIR);
const mailer = createMailer({ smtpUrl: env.SMTP_URL, from: env.MAIL_FROM || 'PDFView <no-reply@localhost>' });
const svc = createService({ db, dataDir: DATA_DIR, mailer, baseUrl: BASE_URL, maxPdfBytes: MAX_PDF_BYTES });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.map': 'application/json', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };

const rate = new Map();
function rateLimited(ip) {
  const now = Date.now();
  let r = rate.get(ip);
  if (!r || now - r.start > RATE_WINDOW_MS) { r = { start: now, n: 0 }; rate.set(ip, r); }
  r.n++;
  if (rate.size > 10000) for (const [k, v] of rate) if (now - v.start > RATE_WINDOW_MS) rate.delete(k);
  return r.n > RATE_LIMIT;
}

function requireAdmin(req) {
  const h = String(req.headers.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m || !safeEqual(m[1].trim(), ADMIN_TOKEN)) throw new HttpError(401, 'Admin token required');
}

function sendPdf(res, bytes, name) {
  res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': bytes.length, 'content-disposition': `inline; filename="${name.replace(/[^A-Za-z0-9._-]+/g, '-')}"`, 'cache-control': 'no-store' });
  res.end(bytes);
}

function serveStatic(req, res, pathname) {
  if (!existsSync(join(APP_DIST, 'index.html'))) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The app has not been built yet. Run "npm run build" in the repository root, then reload.');
    return;
  }
  let file = join(APP_DIST, 'index.html');
  if (!pathname.startsWith('/sign/')) {
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const candidate = resolve(APP_DIST, '.' + rel);
    if (candidate.startsWith(APP_DIST) && existsSync(candidate) && statSync(candidate).isFile()) file = candidate;
  }
  const ext = extname(file).toLowerCase();
  const body = readFileSync(file);
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'content-length': body.length, 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const ADMIN = [
  ['GET', /^\/api\/envelopes$/, () => svc.listEnvelopes()],
  ['POST', /^\/api\/envelopes$/, async (req, info) => [201, await svc.createEnvelope(await readJson(req, BODY_CAP), info)]],
  ['GET', /^\/api\/envelopes\/([a-f0-9]{16})$/, (req, info, m) => svc.full(m[1])],
  ['POST', /^\/api\/envelopes\/([a-f0-9]{16})\/send$/, (req, info, m) => svc.sendEnvelope(m[1], info)],
  ['POST', /^\/api\/envelopes\/([a-f0-9]{16})\/signers\/([a-f0-9]{16})\/link$/, (req, info, m) => svc.issueLink(m[1], m[2], info)],
  ['POST', /^\/api\/envelopes\/([a-f0-9]{16})\/remind$/, (req, info, m) => svc.remind(m[1], info)],
  ['POST', /^\/api\/envelopes\/([a-f0-9]{16})\/void$/, (req, info, m) => svc.voidEnvelope(m[1], info)],
  ['GET', /^\/api\/envelopes\/([a-f0-9]{16})\/audit$/, (req, info, m) => svc.audit(m[1])],
  ['GET', /^\/api\/envelopes\/([a-f0-9]{16})\/documents\/([a-f0-9]{16})\.pdf$/, (req, info, m) => ({ pdf: svc.documentBytes(m[1], m[2]), name: 'document.pdf' })],
  ['GET', /^\/api\/envelopes\/([a-f0-9]{16})\/completed\.pdf$/, (req, info, m) => ({ pdf: svc.completedBytes(m[1]), name: 'completed.pdf' })]
];
const SIGN = [
  ['GET', /^\/api\/sign\/([A-Za-z0-9_-]{20,100})$/, (req, info, m) => svc.signerView(m[1], info)],
  ['GET', /^\/api\/sign\/([A-Za-z0-9_-]{20,100})\/documents\/([a-f0-9]{16})\.pdf$/, (req, info, m) => ({ pdf: svc.signerDocument(m[1], m[2]), name: 'document.pdf' })],
  ['POST', /^\/api\/sign\/([A-Za-z0-9_-]{20,100})$/, async (req, info, m) => svc.submitSign(m[1], await readJson(req, BODY_CAP), info)],
  ['POST', /^\/api\/sign\/([A-Za-z0-9_-]{20,100})\/decline$/, async (req, info, m) => svc.decline(m[1], await readJson(req, 1024 * 1024), info)]
];

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const info = requestInfo(req);
  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    return serveStatic(req, res, pathname);
  }
  const isSign = pathname.startsWith('/api/sign/');
  if (isSign && rateLimited(info.ip)) throw new HttpError(429, 'Too many requests, try again in a minute');
  const table = isSign ? SIGN : ADMIN;
  if (!isSign) requireAdmin(req);
  let pathMatched = false;
  for (const [method, re, fn] of table) {
    const m = re.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (req.method !== method) continue;
    let out = await fn(req, info, m);
    let status = 200;
    if (Array.isArray(out) && typeof out[0] === 'number') [status, out] = out;
    if (out && out.pdf) return sendPdf(res, out.pdf, out.name);
    return sendJson(res, status, out);
  }
  throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Method not allowed' : 'Not found');
}

const server = createServer((req, res) => {
  handle(req, res).catch(e => {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, ...(e.extra || {}) });
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
    else res.end();
  });
});
server.listen(PORT, () => {
  const port = server.address().port;
  console.log(`listening ${port}`);
  console.log(`PDFView envelope service on ${BASE_URL}; data in ${DATA_DIR}; mail ${mailer.configured ? 'configured' : 'not configured'}; app from ${APP_DIST}`);
});

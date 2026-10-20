# PDFView envelope service: API contract

Node 22 built-ins plus `nodemailer` and `pdf-lib`. Storage is SQLite through
`node:sqlite` (file `DATA_DIR/pdfview.db`) and PDF files on disk under
`DATA_DIR/docs/<documentId>.pdf` and `DATA_DIR/completed/<envelopeId>.pdf`.
No native modules. ES modules throughout.

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `DATA_DIR` | `server/data` | database and PDF storage |
| `ADMIN_TOKEN` | generated | bearer token for admin routes; when unset, generated at startup, printed once and written to `DATA_DIR/admin-token.txt` |
| `BASE_URL` | `http://localhost:8787` | used to build signing links |
| `SMTP_URL` | unset | nodemailer transport URL, e.g. `smtps://user:pass@smtp.example.com:465`; when unset no mail is sent and links are shown in the dashboard |
| `MAIL_FROM` | `PDFView <no-reply@localhost>` | From header |
| `MAX_PDF_MB` | `50` | upload cap per document |
| `APP_DIST` | `app/dist` | static files for the dashboard and signer page |

## Static routes

- `GET /` and any path not under `/api` serves `APP_DIST` (single-page app; unknown paths fall back to `index.html`).
- `GET /sign/:token` serves `index.html`; the app reads the token from the path.

## Authentication

Admin routes (`/api/envelopes...`) require `Authorization: Bearer <ADMIN_TOKEN>`. Signer routes (`/api/sign/:token...`) are authenticated by the token alone. Tokens are 32 random bytes, base64url, stored as SHA-256 hex, expire 30 days after issue. Signer routes are rate limited per IP (60 requests per minute) and respond 429 beyond that.

## Entities

- **envelope**: `id` (16 hex), `title`, `message`, `status` (`draft` | `sent` | `completed` | `declined` | `voided`), `sender` `{name,email}`, `created_at`, `sent_at`, `completed_at`, `completed_sha256` (hex, after completion)
- **document**: `id`, `envelope_id`, `idx`, `name`, `pages`, `sha256` of the uploaded bytes
- **signer**: `id`, `envelope_id`, `idx` (signing order, sequential), `name`, `email`, `status` (`pending` | `sent` | `viewed` | `signed` | `declined`), `signed_at`
- **field**: `id`, `envelope_id`, `document_id`, `signer_id`, `page` (0-based), `x`, `y`, `w`, `h`, `rot`, `type` (`signature` | `initials` | `date` | `text` | `checkbox`), `required` (bool), `label`, `value` (set when signed; data URL PNG for signature and initials, string for date and text, boolean for checkbox)
- **event**: `id`, `envelope_id`, `signer_id` (nullable), `type` (`created` | `sent` | `link_issued` | `viewed` | `consented` | `signed` | `declined` | `reminded` | `voided` | `completed`), `at` (ISO), `ip`, `user_agent`, `details` (JSON)

### Field geometry

Fields are in PDF user space of the page they sit on (points, origin at the page's bottom-left, before any `/Rotate`). `(x, y)` is the **visual top-left** corner of the box, `w` and `h` the visual width and height, `rot` the page's effective rotation (0, 90, 180, 270) at placement. To draw with pdf-lib, use the same math as the editor (ported from the original PDF Desk save code):

```js
const frame = a => { const A = a * Math.PI / 180; return { c: Math.cos(A), s: Math.sin(A) }; };
const offset = (P, a, u, v) => { const { c, s } = frame(a); return [P[0] + u * c + v * s, P[1] + u * s - v * c]; };
// bottom-left corner for pdf-lib, then draw with { rotate: degrees(rot) }
const [bx, by] = offset([x, y], rot, 0, h);
page.drawImage(img, { x: bx, y: by, width: w, height: h, rotate: degrees(rot) });
```

Text inside a field: baseline at `offset([x, y], rot, pad, pad + size * 0.93)` with `rotate: degrees(rot)`.

## Admin routes

All bodies and responses are JSON unless noted. Errors: `{ "error": "message" }` with 400, 401, 404, 409, 413 or 429.

### `POST /api/envelopes`
```json
{ "title": "Retainer: Smith", "message": "Please sign.", "sender": { "name": "Alan F. Hamisch", "email": "alan@example.com" },
  "documents": [ { "name": "retainer.pdf", "data": "<base64 PDF>" } ],
  "signers": [ { "name": "Jane Smith", "email": "jane@example.com" } ],
  "fields": [ { "doc": 0, "signer": 0, "page": 0, "x": 72, "y": 200, "w": 180, "h": 40, "rot": 0, "type": "signature", "required": true, "label": "Client signature" } ] }
```
Validates: at least one document whose bytes start with `%PDF-` and are under `MAX_PDF_MB`; at least one signer with a plausible email; every field references an existing document and signer; `page` within the document's page count (counted with pdf-lib). Returns 201 with the full envelope (see GET). Records `created`.

### `GET /api/envelopes`
`[{ id, title, status, created_at, sent_at, completed_at, signers: [{ name, email, status }], documents: [{ name, pages }] }]`, newest first.

### `GET /api/envelopes/:id`
```json
{ "id": "...", "title": "...", "message": "...", "status": "sent", "sender": {...}, "created_at": "...", "sent_at": "...", "completed_at": null, "completed_sha256": null,
  "documents": [ { "id": "...", "idx": 0, "name": "retainer.pdf", "pages": 3, "sha256": "..." } ],
  "signers": [ { "id": "...", "idx": 0, "name": "...", "email": "...", "status": "sent", "signed_at": null } ],
  "fields": [ { "id": "...", "document_id": "...", "signer_id": "...", "page": 0, "x": 72, "y": 200, "w": 180, "h": 40, "rot": 0, "type": "signature", "required": true, "label": "...", "value": null } ],
  "events": [ { "type": "created", "at": "...", "signer_id": null, "ip": "...", "user_agent": "...", "details": {} } ],
  "mail_configured": false }
```

### `POST /api/envelopes/:id/send`
Only from `draft`. Sets `status` to `sent`, issues a token for the first signer (idx 0), emails them when mail is configured. Response: `{ envelope, links: [ { signer_id, url } ] }`. The `url` is `BASE_URL/sign/<token>`; this is the only time the plain token is returned, apart from the link route below. Records `sent` and `link_issued`.

### `POST /api/envelopes/:id/signers/:signerId/link`
Issues a fresh token for that signer (the old one stops working), only when the signer is the current one in order and the envelope is `sent`. Response `{ url }`. Records `link_issued`.

### `POST /api/envelopes/:id/remind`
Re-sends the email to the current signer with a fresh link when mail is configured; otherwise returns the link. Response `{ links: [...] }`. Records `reminded`.

### `POST /api/envelopes/:id/void`
From `draft` or `sent`. Sets `voided`; all tokens stop working. Records `voided`.

### `GET /api/envelopes/:id/documents/:documentId.pdf`
Original bytes, `application/pdf`.

### `GET /api/envelopes/:id/completed.pdf`
The completed file (404 unless `completed`).

### `GET /api/envelopes/:id/audit`
`{ envelope_id, title, status, documents: [{ name, sha256 }], completed_sha256, signers: [...], events: [...] }`.

## Signer routes

### `GET /api/sign/:token`
404 for unknown, expired or voided tokens; 409 if the signer already signed or declined (body includes `status`). Otherwise:
```json
{ "envelope": { "id": "...", "title": "...", "message": "...", "sender": {...} },
  "signer": { "id": "...", "name": "...", "email": "..." },
  "documents": [ { "id": "...", "idx": 0, "name": "...", "pages": 3 } ],
  "fields": [ ...fields for this signer, value null... ],
  "completed_fields": [ ...fields of earlier signers with values, so the page can show them... ] }
```
Records `viewed` once per token (first successful call) and sets the signer to `viewed`.

### `GET /api/sign/:token/documents/:documentId.pdf`
Original bytes for a document in this envelope.

### `POST /api/sign/:token`
```json
{ "consent": true, "fields": [ { "id": "...", "value": "data:image/png;base64,..." }, { "id": "...", "value": "2026-10-19" }, { "id": "...", "value": true } ] }
```
Rejects (400) when `consent` is not `true`, a required field is missing, a signature or initials value is not a PNG data URL under 2 MB, or a field id does not belong to this signer. Records `consented` then `signed` (details: field ids and types), sets the signer `signed` with `signed_at`. Then:
- if a later signer exists: issue their token, email them, record `link_issued`; response `{ status: "sent", next_signer: { name } }`
- otherwise complete: build the completed PDF (below), set `completed`, `completed_at`, `completed_sha256`, record `completed`, email every signer and the sender a link when mail is configured; response `{ status: "completed" }`

### `POST /api/sign/:token/decline`
`{ "reason": "..." }`. Sets the signer and the envelope to `declined`. Records `declined`. Response `{ status: "declined" }`.

## Completed PDF

One file per envelope: every document in `idx` order, each page carried over with pdf-lib `copyPages`, every field with a value drawn on its page (signature and initials as embedded PNG fitted inside the box preserving aspect ratio; date and text in Helvetica sized to fit the box height, no larger than 12 pt; checkbox as two stroked lines when true), followed by a certificate page:

- "Certificate of completion", envelope ID, title, completion time (UTC and ISO)
- documents: name, pages, SHA-256 of the original bytes
- signers: name, email, status, signed time, IP of the signing request
- event table: time, type, signer, IP, user agent (truncated to 60 characters)
- a note that the SHA-256 of this completed file is recorded in the envelope audit record

The certificate page is laid out with pdf-lib text; wrap long lines and continue onto further pages when the events table is long. Helvetica only. No claims of legal validity or compliance in the text.

Document metadata of the completed file: title set to the envelope title, producer `PDFView`.

## Mail

Templates are plain text. Signing request: subject `"<sender name> sent you a document to sign: <title>"`, body with the message, the link, and a line that the link is personal and expires. Completion: subject `"Completed: <title>"` with the download link `BASE_URL/api/envelopes/<id>/completed.pdf` is **not** usable by signers (it is an admin route), so instead attach the completed PDF to the completion email. When `SMTP_URL` is unset, `sendMail` resolves without sending and logs one line.

## Tests (`node --test server/test/`)

Spawn the server on a random free port with a temporary `DATA_DIR`, no `SMTP_URL`, `ADMIN_TOKEN=test`. Generate a two-page PDF with pdf-lib. Cover: create, list, get, send (link returned), signer GET (viewed event), POST sign with consent and a 1x1 PNG signature, second signer flow, completed.pdf parses with pdf-lib and has pages + 1, audit lists the events in order, 401 without token, 404 for a bad signer token, 400 without consent, decline path, void path, rate limit returns 429 after 60 signer calls in a minute.

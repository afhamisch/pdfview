# PDFView envelope service

The server behind envelopes and signing. Node 22, no native modules: SQLite
through `node:sqlite`, PDFs on disk, `pdf-lib` for the completed file,
`nodemailer` for mail. The HTTP API is specified in `API.md`.

## Run

```
npm install            # from the repository root
npm run build          # builds app/dist, which the server serves
npm start              # or: node server/src/index.js
```

The first start without `ADMIN_TOKEN` generates a token, prints it once and
writes it to `DATA_DIR/admin-token.txt`. The dashboard asks for that token.
The experimental warning from `node:sqlite` is expected.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | HTTP port (`0` picks a free port and prints `listening <port>`) |
| `DATA_DIR` | `server/data` | database and PDF storage |
| `ADMIN_TOKEN` | generated | bearer token for the admin routes |
| `BASE_URL` | `http://localhost:8787` | prefix of the signing links in mail and in the dashboard |
| `SMTP_URL` | unset | nodemailer URL such as `smtps://user:pass@smtp.example.com:465` |
| `MAIL_FROM` | `PDFView <no-reply@localhost>` | From header |
| `MAX_PDF_MB` | `50` | size cap per uploaded document |
| `APP_DIST` | `app/dist` | built app to serve |

## Mail

With `SMTP_URL` set, each signer gets a plain-text message with their
personal link when it is their turn, and everyone gets the completed PDF
attached when the last signer finishes. Without `SMTP_URL`, nothing is sent:
the send and remind responses return the links and the dashboard shows them
to copy. Links expire 30 days after issue; issuing a new link invalidates the
previous one.

## Data

```
DATA_DIR/pdfview.db          SQLite database (WAL mode)
DATA_DIR/docs/<id>.pdf       uploaded documents, as received
DATA_DIR/completed/<id>.pdf  completed envelopes with the certificate pages
DATA_DIR/admin-token.txt     generated admin token, when ADMIN_TOKEN was unset
```

Signer tokens are stored only as SHA-256 hashes. Every state change is an
event with time, IP and user agent; `GET /api/envelopes/:id/audit` returns
them along with the SHA-256 of each original document and of the completed
file.

To reset, stop the server and delete `DATA_DIR`.

## Tests

```
cd server && npm test
```

The tests start the server on a free port with a temporary `DATA_DIR` and
exercise the whole flow: create, send, view, sign through two signers,
completion, decline, void, authentication and the rate limit.

# PDFView

A PDF viewer and editor for a small litigation practice, with an envelope-based
e-signature service. Built to replace Acrobat for day-to-day work (read, search,
fill, sign, redact, organize, Bates-number, print) and a hosted signature product
for retainers and client documents.

Jonathan's original single-file viewer is kept unchanged as `pdf-desk.html`;
`bench/` holds the harness used to measure it. Everything new lives in `app/`
(the browser app) and `server/` (the envelope service). `ROADMAP.md` lists what
is in this release and what is not.

## Run it

Requirements: Node 22 or newer. No native modules.

```
npm install
npm run build            # builds app/dist
npm start                # serves the app and the envelope API on http://localhost:8787
```

Email: set `SMTP_URL` and `MAIL_FROM` on the server (one mailbox for the whole
firm; each message carries a reply-to of whoever sent the envelope). The server
prints an admin token on first start and writes it to
`server/data/admin-token.txt`. The app asks for it the first time you open the
Envelopes panel or send a document. See `server/README.md` for the environment
variables (port, data directory, SMTP for email, base URL for signing links)
and `docs/DEPLOYMENT.md` for hosting the site on a server with HTTPS and
keeping it updated.

Offline, no server: `npm run build:offline` produces `app/dist-offline/index.html`,
a single file (about 5 MB) that opens from disk with the viewer and editor only (no
envelopes). The build copies pdf.js's run-time resources (JBIG2 and JPX decoders for
scanned PDFs, standard fonts, CMaps) into `app/public/pdfjs` for the served app and
inlines the decoders and fonts into the offline file.

Development: `npm run dev` runs Vite on port 5173 and proxies `/api` and `/sign`
to a server started with `npm start`.

## What it does

Viewer: pdf.js in a real worker, pages rendered on demand and released when far
away (a 500-page file or a 150 MB scan stays responsive), text selection, find
with highlighting, thumbnails and bookmarks, page readout with go-to, zoom that
keeps your place, rotate, print through the browser's own PDF viewer.

OCR: scanned pages are recognized on this computer (tesseract.js, English);
the words become selectable and searchable at once and are written into the
saved copy as invisible text so Acrobat, Edge and e-filing portals can search
it too. Available in the served app and the desktop wrapper (the engine files
are about 15 MB and are not inlined into the single offline file).

Several PDFs open at once, one per tab: each keeps its pages, placed items,
typed form values, undo history and scroll position. Ctrl+] and Ctrl+[ switch
tabs; in the desktop app Ctrl+PageDown, Ctrl+PageUp, Ctrl+Tab and Ctrl+W work
too (a browser keeps those for its own tabs).

Editor: edit the text that is already on the page (with the Text tool, click a
paragraph, heading or table cell: it lifts off the page as an editable text
box with the same wording, size, color, spacing and a matching font, the old
wording is removed from the file, and you can retype, add to or move it; words
in scans and text inside graphics are covered with white and retyped
instead); fill form fields, add text with fonts (Helvetica, Times, Courier, plus
bundled open fonts such as Tinos, Arimo, Cousine, EB Garamond, Crimson Pro,
Libre Baskerville and DejaVu, and any TrueType or OpenType font dropped into
`app/fonts`), bold, italic, underline, alignment including justified, bullets
and numbering, any color, and boxes that wrap; highlight by dragging over words
or drawing a box; a freehand marker and pen; shapes (line, arrow, rectangle,
ellipse); an eraser that paints over just the part you drag across; a snapshot
tool that copies any part of a page as an image or as text; stamps (EXHIBIT, FILED, CONFIDENTIAL or your
own wording), check marks, signatures (draw or type), highlight, white-out, redact (the page is rasterized with the boxes burned in so nothing under them survives: the page's text, fonts, images, form fields, comments and links are dropped, as are the document's title and keyword metadata, embedded files and structure tree, and the saved file has no earlier revisions;
fields and metadata on it removed, orphaned objects dropped), organize pages
(reorder, rotate, delete, insert from another PDF, extract pages), Bates numbering, save a new
copy. Items you add stay editable when you reopen the saved copy here.

E-signature: place signature, initials, date, text and checkbox fields for one
or more signers, send. Signers get a personal link (by email when SMTP is set,
otherwise copy it from the dashboard), must agree to sign electronically, and
sign in order. Every step is recorded with time, IP address and browser. The
completed PDF carries the signatures and a certificate page with the envelope ID,
signer list, event log and SHA-256 of the originals.

## Tests

```
npm --workspace server test          # API and signing flow (node:test)
cd app && node test/m1.js URL PDF    # viewer: search, navigation, thumbnails on a large file
cd app && node test/m2.js URL        # editor: fill, text, highlight, redact, Bates, organize, save, reopen
cd app && node test/m3.js URL        # envelopes: compose, send, two signers, completed download
cd app && node test/real.js URL PDF DIR  # full round trip on a real file (scan, rotated pages), screenshots to DIR
cd app && node test/forms.js URL PDF DIR NAME  # fill a form-heavy PDF, save fillable and flattened, reopen
cd app && node test/ocr.js URL PDF WORD DIR    # OCR a scan, search WORD, save with invisible text, reopen and search
```

The browser tests need Playwright with Chromium and a server (or a static
server for `dist`) at URL.

## Windows default viewer

See `desktop/README.md`. A Tauri wrapper registers the `.pdf` file association
and opens files in this app. The `Desktop (Windows installer)` workflow under
Actions builds it and uploads the installer as an artifact. `docs/DEPLOYMENT.md`
describes the planned auto-update (signed releases the app installs itself).

## Limits of this release

No document compare, no bookmark editing, OCR in English only. The e-signature service keeps an
audit trail but does not apply PKCS#7 digital signatures or trusted timestamps,
and nothing in the interface claims legal compliance. See `ROADMAP.md`.

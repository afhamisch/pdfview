# PDFView roadmap

PDFView is a PDF viewer and editor for a small litigation practice, with an
envelope-based e-signature service, meant to replace Acrobat and a hosted
signature product. It is built fresh under `app/` and `server/`.
Jonathan's original single-file viewer (`pdf-desk.html`) stays in the repo
unchanged; its proven ideas (rotation geometry, raster redaction, the
editable layer that survives save and reopen) are ported with credit.

## v0.1 (this release)

Viewer
- pdf.js 6.x in a real Web Worker, virtualized page rendering with a
  bounded render queue and canvas release for long files
- text layer: select and copy text
- search (Ctrl+F) with per-page hit highlighting, next and previous
- thumbnails sidebar, outline (bookmarks) panel, page readout with go-to
- zoom that keeps your place (buttons, Ctrl+wheel, Ctrl plus/minus/0),
  fit width, rotate
- print by opening the saved PDF in the browser's own print path

Editor
- tabs: several PDFs open at once, each with its own state
- save in place (desktop, Chrome, Edge) and Save as; redacted copies always
  get a new name
- notes saved as comment annotations; existing comments listed in the sidebar
- document properties: view, edit title/author/subject/keywords, strip all
- edit existing text: a block lifts off the page as a text object (the
  drawing operators come out of the content stream, position and spacing
  kept, font matched to a bundled lookalike); scans and text in graphics
  are covered and retyped
- fill form fields, add text (standard and bundled or user-supplied fonts,
  size, bold, italic, underline, left, center, right and justified, bullets
  and numbering, color, wrapping boxes), stamps with presets, freehand
  marker and pen, shapes (line, arrow, rectangle, ellipse), eraser,
  snapshot of a page region as image or text (exhibit labels, FILED,
  CONFIDENTIAL, dated RECEIVED, custom), check marks, signatures (draw or
  type), highlight, white-out
- redaction: the page is rasterized with the boxes burned in, fields,
  annotations and document metadata on that page are removed, unreferenced
  objects are dropped from the saved file
- organize pages: reorder, rotate, delete, insert pages from another PDF,
  extract selected pages to a new file, combine files by opening or
  dropping several at once
- Bates numbering: prefix, start number, zero padding, corner, font size
- save a new copy; added items stay editable when the copy is reopened here

E-signature (server)
- envelopes with one or more PDFs, ordered signers, placed fields
  (signature, initials, date signed, text, checkbox)
- tokenized per-signer links, signer page with explicit consent to
  electronic records, draw or type signature
- audit trail: created, sent, viewed, consented, signed, declined,
  completed, each with time, IP and user agent
- completion: fields stamped into the PDF with pdf-lib, certificate page
  with envelope ID, signers, events, SHA-256 of original and final files
- email through SMTP when configured; otherwise the dashboard shows the
  signing link to copy
- single-owner admin token; SQLite through node:sqlite; no native modules

Offline build
- `npm run build:offline` produces one HTML file (worker inlined) that
  opens from disk with no server, viewer and editor only

OCR
- English text recognition for scanned pages in the browser (tesseract.js),
  selectable and searchable immediately, written into the saved file as
  invisible text

## Out of scope for v0.1

- document compare, bookmark editing, form field creation, OCR languages
  other than English
- redaction that keeps the rest of the page as text (today the whole
  redacted page becomes an image; run OCR on it to make it searchable again)
- mixed styles inside one edited paragraph (a bold word in a regular
  paragraph takes the paragraph's style once lifted)
- Windows installer built locally: the Tauri wrapper in `desktop/` is built
  by the GitHub Actions workflow on a Windows runner
- PKCS#7 digital signatures and trusted timestamps on completed envelopes
- multi-user accounts, roles, SSO
- any claim of legal compliance in the UI; the audit trail is evidence,
  not a certification

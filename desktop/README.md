# Desktop wrapper (Windows default PDF viewer)

A web page cannot be a Windows default handler for `.pdf`; only an installed
application can. The smallest wrapper is Tauri: it ships a tiny executable that
uses the WebView2 runtime already on Windows 10 and 11 (Chromium), so the
viewer behaves exactly as it does in Edge.

This folder documents the setup; the wrapper has to be built on a Windows
machine (or a Windows runner in CI), since the Linux build environment this
project was prepared in cannot produce a Windows installer.

## Setup

1. Install Rust (rustup) and the Tauri prerequisites for Windows (WebView2 is
   preinstalled on current Windows; the installer bundles it otherwise).
2. From the repository root:
   ```
   npm run build:offline
   npx @tauri-apps/cli init --app-name PDFView --window-title PDFView --frontend-dist ../app/dist-offline --dev-url http://localhost:5173
   ```
3. In `src-tauri/tauri.conf.json` add the file association so the installer
   registers PDFView for `.pdf` and Windows lists it under Default apps:
   ```json
   "bundle": {
     "fileAssociations": [
       { "ext": ["pdf"], "name": "PDF document", "description": "PDF document", "mimeType": "application/pdf", "role": "Editor" }
     ]
   }
   ```
4. Hand the opened file to the page. In `src-tauri/src/main.rs`, read the
   path from the launch arguments (`std::env::args().nth(1)`) and from the
   single-instance plugin for "Open with" while running, read the bytes, and
   call into the page:
   ```rust
   window.eval(&format!("window.pdfviewOpen({}, {:?})", serde_json::to_string(&bytes)?, name))?;
   ```
   The app exposes `window.pdfviewOpen(bytesArray, name)` for this purpose
   (see `app/src/main.js`).
5. Build the installer: `npx @tauri-apps/cli build`. Install it, then pick
   PDFView under Settings, Apps, Default apps, `.pdf`.

## Saving

In the browser build, Save downloads a copy. The wrapper can offer a native
Save dialog by exposing a `save` command from Rust and calling
`window.pdfviewSaveHook = async ({ filename, bytes }) => ...` before the page
loads; when that hook is present the app calls it instead of downloading.

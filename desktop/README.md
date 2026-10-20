# Desktop wrapper (Windows default PDF viewer)

A web page cannot be a Windows default handler for `.pdf`; only an installed
application can. This folder is a Tauri 2 wrapper: a small executable that
hosts the offline build of the app in the WebView2 runtime already on
Windows 10 and 11 (Chromium, so the viewer behaves as it does in Edge), and
registers the `.pdf` file association when installed.

## Getting the installer

The GitHub Actions workflow `.github/workflows/desktop.yml` builds the
installer on a Windows runner on every push to `main` that touches the app or
the wrapper, and on demand from the Actions tab (Run workflow). Download the
`PDFView-windows` artifact; it holds `PDFView_x.y.z_x64-setup.exe` (NSIS,
installs for the current user, no admin rights) and an `.msi`.

After installing, Windows lists PDFView under Settings, Apps, Default apps,
`.pdf`. Double-clicking a PDF, or "Open with", opens it in PDFView; a second
file while the app is running opens in the same window.

## Building locally (Windows)

1. Install Rust (rustup) and Node 22. WebView2 is preinstalled on current
   Windows; the installer bundles a bootstrapper otherwise.
2. From the repository root: `npm install`, `npm run build:offline`.
3. `cd desktop`, `npx tauri icon icon.png` (generates `src-tauri/icons`), then
   `npx tauri build`. The installer lands in `src-tauri/target/release/bundle`.

`npx tauri dev` runs the wrapper against the offline build for a quick check.

## How the page and the wrapper talk

`app/src/desktop.js` runs only when the page is inside the wrapper
(`window.__TAURI__` exists):

- on start it asks the wrapper for files passed on the command line
  (`pending_files`), reads them (`read_file`) and opens the first one;
- `open-files` events arrive when another PDF is double-clicked while the app
  is running (single-instance plugin);
- Save calls `save_file` with the PDF bytes as a binary IPC body and the
  suggested name in a header; the wrapper shows a native Save dialog and
  writes the file.

The Rust side is `src-tauri/src/lib.rs`; permissions are in
`src-tauri/capabilities/default.json`.

## Not covered

Envelopes need the server; the wrapper is the viewer and editor only. The
Linux build environment this project was prepared in has no GTK or WebKit
development packages, so the wrapper was syntax-checked here and compiled
by the Windows workflow, not locally.

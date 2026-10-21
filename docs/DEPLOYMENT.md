# Hosting PDFView and keeping it updated

For whoever sets up the hosted site and the desktop auto-update. It covers
what exists today, what is still to build, and the exact steps. Nothing here
needs the Claude session that wrote the code; the repository is the whole
source of truth.

## The three ways PDFView runs

| Form | What it is | Where updates come from |
|---|---|---|
| Hosted site | `server/` (Node 22) serving the built `app/dist` plus the envelope API | the server: pull, build, restart (or an automatic deploy, below) |
| Windows app | `desktop/` (Tauri 2) hosting `app/dist-desktop` in WebView2, registered as the `.pdf` handler | today: download the installer from GitHub Actions; to build: auto-update (below) |
| Offline file | `npm run build:offline`, one HTML file | copy the new file |

Everything but Envelopes works in all three. Envelopes (sending for
signature, tracking, audit) need the server, so today they only show in the
hosted site. The desktop app hides the Send and Envelopes buttons
(`served()` in `app/src/api.js` is false under Tauri). Pointing the desktop
app at the hosted server is part of the auto-update work below.

## Part 1: the hosted site

Goal: `https://pdf.exhibitfy.com` (any subdomain works) serves the current
app and the envelope API, always the latest merged version, usable by anyone
at the firm from a browser, with envelope links that clients can open.

### Requirements

- Node 22.5 or newer. The server uses `node:sqlite`, which is built into
  Node from 22.5; there are no native modules to compile.
- A place to run a long-lived Node process. Any Linux VPS works (Hetzner,
  DigitalOcean, Linode, 1 vCPU and 1 GB RAM is plenty). A shared PHP host
  only works if its control panel offers a Node.js application feature
  (cPanel "Setup Node.js App", Plesk "Node.js") and lets you pick Node 22.5+.
- HTTPS. Signing links go to clients, so the site must be TLS. Caddy does
  this with no configuration; nginx with certbot also works.
- DNS: an `A` record for the subdomain pointing at the box.
- Mail: an SMTP account the server can send through (SMTP_URL and
  MAIL_FROM below). One firm mailbox is enough; each envelope's mail carries
  the sender's address as Reply-To.

### Setup on a VPS (Ubuntu or Debian)

```sh
# 1. Node 22 (NodeSource) and git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs git
node -v    # must be 22.5 or newer

# 2. A service user and the code
sudo useradd -r -m -s /usr/sbin/nologin pdfview
sudo -u pdfview git clone https://github.com/afhamisch/pdfview.git /home/pdfview/pdfview
cd /home/pdfview/pdfview
sudo -u pdfview npm ci
sudo -u pdfview npm run build     # builds app/dist, which the server serves

# 3. Settings: /etc/pdfview.env (readable by the pdfview user only)
sudo tee /etc/pdfview.env >/dev/null <<'EOF'
PORT=8787
DATA_DIR=/home/pdfview/data
APP_DIST=/home/pdfview/pdfview/app/dist
BASE_URL=https://pdf.exhibitfy.com
SMTP_URL=smtps://USER:PASSWORD@smtp.example.com:465
MAIL_FROM=The Law Office of Alan F. Hamisch <signing@napleslitigation.com>
MAX_PDF_MB=50
EOF
sudo chown pdfview:pdfview /etc/pdfview.env && sudo chmod 600 /etc/pdfview.env
sudo -u pdfview mkdir -p /home/pdfview/data

# 4. systemd unit
sudo tee /etc/systemd/system/pdfview.service >/dev/null <<'EOF'
[Unit]
Description=PDFView (viewer, editor and envelope service)
After=network.target

[Service]
User=pdfview
WorkingDirectory=/home/pdfview/pdfview
EnvironmentFile=/etc/pdfview.env
ExecStart=/usr/bin/node server/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now pdfview
sudo journalctl -u pdfview -n 40     # the admin token is printed here on first start
```

The admin token is also saved in `DATA_DIR/admin-token.txt`. It is the
password for the Envelopes screen; everyone at the firm uses the same one.
To set your own instead, add `ADMIN_TOKEN=...` to `/etc/pdfview.env`.

### HTTPS with Caddy

```sh
sudo apt-get install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
pdf.exhibitfy.com {
    reverse_proxy 127.0.0.1:8787
    request_body { max_size 60MB }
}
EOF
sudo systemctl reload caddy
```

Caddy obtains and renews the certificate itself once DNS points at the box.
With nginx instead: `proxy_pass http://127.0.0.1:8787;`,
`client_max_body_size 60m;`, and certbot for the certificate.

### Setup on a cPanel host with "Setup Node.js App"

1. Create the subdomain in cPanel; note its document root.
2. Setup Node.js App: Node version 22 (must be 22.5+; if the host only
   offers 18 or 20, stop here and use a VPS), application root = a folder
   holding a clone of the repository, application startup file =
   `server/src/index.js`, application URL = the subdomain.
3. Add the environment variables from step 3 above in the app's settings
   panel (PORT is set by the host; leave it out). `DATA_DIR` must be a
   folder outside the web root.
4. Open the host's terminal for that app and run `npm ci && npm run build`.
5. Restart the app from the panel. The admin token is in
   `DATA_DIR/admin-token.txt`.

Passenger (what cPanel uses) idles the process when nobody is using it and
restarts it on the next request, which is fine for this server.

### Checking it works

- Open the subdomain: the viewer loads, the sample form opens.
- Envelopes: paste the token, create a test envelope to your own address;
  the mail arrives with a link that opens the signing page over HTTPS.
- `server/API.md` lists every endpoint if you want to curl them.

### Updating the hosted site

By hand, after a merge to `main`:

```sh
cd /home/pdfview/pdfview
sudo -u pdfview git pull
sudo -u pdfview npm ci
sudo -u pdfview npm run build
sudo systemctl restart pdfview
```

Automatic, so a merge deploys itself: add a GitHub Actions workflow
(`.github/workflows/deploy.yml`) that runs on push to `main`, connects over
SSH with a deploy key stored as a repository secret, and runs those four
commands. The `appleboy/ssh-action` action is the usual way. The key needs
to be a dedicated SSH key for the `pdfview` user with no passphrase, and
`sudo systemctl restart pdfview` must be allowed for that user in sudoers
(`pdfview ALL=NOPASSWD: /bin/systemctl restart pdfview`).

Data (`DATA_DIR`) is outside the checkout, so updates never touch it. Back
it up: it holds every envelope, document and audit trail.

## Part 2: auto-update for the Windows app

Goal: the installed app checks GitHub when it starts, downloads a newer
build in the background, and installs it on the next restart. Nobody
downloads installers by hand.

Status: built. The wrapper has the updater and process plugins, the public
key and the release endpoint are in `tauri.conf.json`, the page checks for
an update a few seconds after start and every four hours and shows a
"Restart now" bar, and the `release` job in `.github/workflows/desktop.yml`
publishes a signed GitHub Release on every merge to `main` with the version
`0.2.<run number>`. The one thing it needs from a repository admin: the two
secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
(GitHub, the repository, Settings, Secrets and variables, Actions, New
repository secret). Until they exist the release job stops early and the
installer is only available as an Actions artifact. Copies installed before
the updater existed must be replaced by hand once; from then on they update
themselves.

The pieces, for reference:

### 1. Signing keys (once)

```sh
cd desktop
npx tauri signer generate -w ~/.tauri/pdfview.key
```

This prints a public key and writes a private key file. Put the private key
and its password in the repository's GitHub secrets as
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The
public key goes in `tauri.conf.json` (next step). Keep the private key
somewhere safe outside the repo: without it, no future build can be
installed over the current one through the updater (users would have to
install by hand once).

### 2. Wrapper changes

- `desktop/src-tauri/Cargo.toml`: add `tauri-plugin-updater = "2"` and
  `tauri-plugin-process = "2"` (for the restart).
- `desktop/src-tauri/src/lib.rs`: register both plugins next to the dialog
  and single-instance plugins that are already there.
- `desktop/src-tauri/tauri.conf.json`: add

  ```json
  "plugins": {
    "updater": {
      "pubkey": "<public key from step 1>",
      "endpoints": ["https://github.com/afhamisch/pdfview/releases/latest/download/latest.json"]
    }
  },
  "bundle": { "createUpdaterArtifacts": true }
  ```

- `desktop/src-tauri/capabilities/default.json`: allow `updater:default`
  and `process:default`.
- Page side (`app/src/desktop.js`, runs only inside the wrapper): on start,
  call `check()` from `@tauri-apps/plugin-updater`; if an update exists,
  `downloadAndInstall()` in the background, then show a small toast "Update
  ready, restart PDFView to install" with a Restart button that calls
  `relaunch()` from `@tauri-apps/plugin-process`. Add both npm packages to
  `app/package.json`. A failed check (offline) must be silent.

### 3. Releases from GitHub Actions

Change `.github/workflows/desktop.yml` so that a push to `main` (or a tag
`v*`) builds with the signing secrets in the environment and publishes a
GitHub Release containing the installer, the `.sig` file and `latest.json`.
`tauri-apps/tauri-action` does all of that in one step:

```yaml
- uses: tauri-apps/tauri-action@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
  with:
    projectPath: desktop
    tagName: v__VERSION__
    releaseName: PDFView v__VERSION__
    releaseDraft: false
```

The version comes from `desktop/src-tauri/tauri.conf.json` (`0.1.0` today).
Bump it for every release; the updater only installs a higher version. The
`latest.json` the action writes is what the endpoint URL above resolves to.

Keep the current artifact upload step too, so branch builds still produce
an installer to test without publishing a release.

### 4. Envelopes from the desktop app

Today `served()` in `app/src/api.js` is false under Tauri, so the app hides
Send and Envelopes. To use the hosted server from the app:

- add a setting for the server address (localStorage key, with a small
  dialog under the Envelopes button; default to the hosted subdomain);
- make `api()` prefix that address and send the admin token as it does now;
- the signing links in mail already point at `BASE_URL`, so clients are
  unaffected.

The server must then allow cross-origin requests from the app's origin
(`tauri://localhost` and `http://tauri.localhost`): a CORS allow list in
`server/src/index.js` keyed on an env variable such as `ALLOWED_ORIGINS`.

### 5. Code signing (separate, optional)

Windows SmartScreen warns on the unsigned installer. An Authenticode
certificate (an OV certificate from a CA such as Sectigo or DigiCert, roughly
200 to 400 dollars a year, or Azure Trusted Signing at a few dollars a month)
removes the warning. With the certificate in GitHub secrets, Tauri signs the
installer during the build (`bundle.windows.certificateThumbprint` or
`signCommand` in `tauri.conf.json`). This is independent of the updater
signature, which only proves the update came from our build.

## What the owner needs to provide

- Hosting: either a VPS login, or confirmation that the current host offers
  Node 22.5+ through its control panel.
- DNS access to add the subdomain record.
- SMTP: server, port, user, password, and the From address to use.
- GitHub: repository secrets for the updater keys (and the deploy SSH key if
  automatic deploys are wanted). Only a repository admin can add secrets.

## Checklist

Hosted site
- [ ] DNS record for the subdomain
- [ ] Node 22.5+ where the server will run
- [ ] clone, `npm ci`, `npm run build`
- [ ] `/etc/pdfview.env` with BASE_URL, DATA_DIR, SMTP_URL, MAIL_FROM
- [ ] systemd service (or cPanel Node app) running
- [ ] HTTPS in front of port 8787
- [ ] token from `DATA_DIR/admin-token.txt` shared with the firm
- [ ] test envelope sent and signed over the public address
- [ ] backups of `DATA_DIR`
- [ ] optional: deploy workflow with SSH key

Desktop auto-update
- [ ] signing key pair generated, private key and password in GitHub secrets
- [ ] updater and process plugins in the wrapper, public key and endpoint in `tauri.conf.json`
- [ ] update check, background download and restart prompt in `app/src/desktop.js`
- [ ] workflow publishes a Release with installer, `.sig` and `latest.json`
- [ ] version bump in `tauri.conf.json` on each release
- [ ] server address setting in the app and CORS allow list on the server
- [ ] optional: Authenticode certificate for SmartScreen

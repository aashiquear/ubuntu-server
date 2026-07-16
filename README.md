# 🐧 Ubuntu Web Dashboard

A self-contained, Docker-deployable dashboard that turns an Ubuntu server
(targeting **Ubuntu 26.04**) into a workspace you can reach from any machine on
the same LAN using nothing but a **web browser**.

Sign in with your **existing system / SSH account** and get, each in its own
browser tab and all running on the server:

- 📁 **File Browser** — browse your home directory with drag-and-drop upload & download
- 💻 **Terminal** — a full interactive shell, running as you
- 🧩 **Web VS Code** — a stable build of VS Code (code-server) on the server
- 🖼️ **Remote Desktop** — a graphical XFCE desktop over **XRDP**, rendered in the browser

The landing page also shows a welcome note and **two live clocks** — one for the
server and one for your browser — so time-zone differences are always visible.

---

## Table of contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start (Docker)](#quick-start-docker)
- [Connecting from another machine on the LAN](#connecting-from-another-machine-on-the-lan)
- [Authentication & users](#authentication--users)
- [Features in detail](#features-in-detail)
- [Configuration](#configuration)
- [Use cases](#use-cases)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Development (running without Docker)](#development-running-without-docker)
- [License](#license)

---

## How it works

A single Node.js web app is the **front door** on the published port (default
`8080`). It authenticates sign-ins against the host's PAM stack — the same
credentials used for SSH — and then brokers access to each feature, which run as
ordinary services on the same machine:

```
                    Browser (any LAN machine)
                              │  http(s)://server-ip:8080
                              ▼
┌───────────────────────────────────────────────────────────────┐
│  App container (Ubuntu 26.04)                                   │
│                                                                 │
│   ┌───────────────┐   PAM auth (SSH users)                      │
│   │  Dashboard    │───────────────────────────────┐            │
│   │  (Node/Express│                                │            │
│   │   + WebSocket)│  /ws/terminal ── node-pty ──► login shell   │
│   │               │  /api/files  ── fs (home jail)              │
│   │               │  /vscode     ── reverse proxy ─► code-server│
│   │               │  /ws/guac    ── guacamole-lite ─┐          │
│   └───────────────┘                                 │          │
│                                                     ▼          │
│   Services (supervisord):                     (RDP 3389)       │
│     sshd · xrdp + xrdp-sesman · code-server · dashboard        │
└────────────────────────────────────────────────────┼──────────┘
                                                      │ RDP
                              ┌───────────────────────▼──────────┐
                              │  guacd sidecar (guacamole/guacd) │
                              └──────────────────────────────────┘
```

> **Why two containers?** `guacd` (the daemon that speaks RDP) is no longer
> packaged in current Ubuntu, and building it from source is fragile on
> releases that ship FreeRDP 3. Running the official prebuilt
> `guacamole/guacd` image as a sidecar is Guacamole's recommended deployment.
> The dashboard talks to it over TCP, and it connects back to the app
> container's XRDP — all handled by `docker-compose.yml`.

- **Terminal** streams a real PTY (`node-pty`) over a WebSocket to
  [xterm.js](https://xtermjs.org/) in the browser, spawned with your uid/gid.
- **Files** are served by a small REST API jailed to your home directory;
  uploads are chowned back to you.
- **Web VS Code** is a shared [code-server](https://github.com/coder/code-server)
  instance bound to localhost and reachable only through the authenticated
  `/vscode` reverse proxy.
- **Remote Desktop** uses [guacamole-lite](https://github.com/vadimpronin/guacamole-lite)
  + `guacd` to bridge the browser to the server's **XRDP** service. RDP
  credentials never leave the server — the browser only ever holds an encrypted
  connection token.

Everything is exposed on **one port**, so there's a single thing to publish to
your LAN.

---

## Requirements

- A machine (or VM) running Docker + Docker Compose.
- Network reachability from the other LAN machines to the server's port `8080`.
- For the desktop feature, the host should allow the container the modest extra
  privileges shown in `docker-compose.yml` (`shm_size`, `SYS_PTRACE`).

> **Note on the base image:** the image is built `FROM ubuntu:26.04`. If that
> tag is not yet published in your registry, change the first line of the
> `Dockerfile` to `ubuntu:24.04` — everything else is identical.

---

## Quick start (Docker)

```bash
git clone https://github.com/aashiquear/ubuntu-server.git
cd ubuntu-server

# Build and start
docker compose up -d --build
```

That's it. The compose file creates a convenience account **`ubuntu` /
`ubuntu`** on first boot so you can log in immediately. Open:

```
http://<server-ip>:8080
```

and sign in. **Change or remove that account before using this on a real
network** (see [Authentication & users](#authentication--users)).

To stop / remove:

```bash
docker compose down            # keep home volume
docker compose down -v         # also delete home directories
```

### Without Compose

The **Remote Desktop** feature needs the `guacd` sidecar, so run both
containers on a shared network:

```bash
docker build -t ubuntu-web-dashboard .
docker network create ubws-net

# guacd (RDP proxy)
docker run -d --name ubuntu-web-guacd --network ubws-net \
  guacamole/guacd:1.5.5

# the dashboard app
docker run -d --name ubuntu-web-dashboard --network ubws-net \
  -p 8080:8080 \
  --shm-size=1g --cap-add=SYS_PTRACE \
  -e DEFAULT_USER=ubuntu -e DEFAULT_PASSWORD=ubuntu \
  -e GUACD_HOST=ubuntu-web-guacd -e RDP_HOST=ubuntu-web-dashboard \
  -v ubws-home:/home \
  ubuntu-web-dashboard
```

The other three features (files, terminal, Web VS Code) work with just the
dashboard container; only Remote Desktop requires `guacd`. Using
`docker compose up` is simpler and wires all of this for you.

---

## Connecting from another machine on the LAN

1. Find the server's LAN IP address:
   ```bash
   hostname -I        # or: ip -4 addr
   ```
   e.g. `192.168.1.50`.
2. From any other computer, phone, or tablet on the same network, open a
   browser to:
   ```
   http://192.168.1.50:8080
   ```
3. Sign in with an account that exists on the server. Open any feature — it
   launches in a new tab and runs on the server while you interact with it from
   your device.

If you can't connect, make sure the host firewall allows the port, e.g.:

```bash
sudo ufw allow 8080/tcp
```

---

## Authentication & users

Sign-in is validated through **PAM** (service `ubws`, which includes
`common-auth`/`common-account`) — i.e. the same username/password used for SSH
or console login. System accounts (`uid < 1000`) and `root` are rejected by
default.

There are two ways to decide *which* accounts can log in:

### A) Container accounts (default, good for demos)

The container has its own user database. The compose file seeds one account via
`DEFAULT_USER` / `DEFAULT_PASSWORD`. You can add more at any time:

```bash
docker exec -it ubuntu-web-dashboard bash
adduser alice          # create an account that can now sign in to the dashboard
```

Home directories live on the `ubws-home` volume so they survive restarts.

### B) Using host SSH users (production)

To authenticate against the **host machine's real accounts**, mount its user
database and home directories read-only and drop the demo account. In
`docker-compose.yml`:

```yaml
    environment:
      - TZ=UTC
      # (remove DEFAULT_USER / DEFAULT_PASSWORD)
    volumes:
      - /etc/passwd:/etc/passwd:ro
      - /etc/shadow:/etc/shadow:ro
      - /etc/group:/etc/group:ro
      - /home:/home
```

Now anyone with an SSH account on the host can sign in with their normal
credentials, and their real home directory is what they see and work in.

> Because the desktop feature logs in over RDP on your behalf, your password is
> held **in the server-side session only** for the lifetime of your login and is
> never sent to the browser or exposed by any API.

---

## Features in detail

### 📁 File Browser (`/files`)
- Navigate your home directory with breadcrumbs.
- **Drag files from your computer** onto the list to upload (with a progress
  bar), or use the **Upload** button.
- **Click a file to download** it; use per-row **download** / **delete**, or
  **New folder** to organise.
- All paths are jailed to your home directory; uploads are owned by you.

### 💻 Terminal (`/terminal`)
- A real login shell (`node-pty`) rendered with xterm.js, resizable, with a live
  connection indicator. Runs as your user with your environment.

### 🧩 Web VS Code (`/vscode/`)
- A stable code-server build. It binds to localhost with auth disabled and is
  only reachable through the dashboard's authenticated proxy, so your session is
  the gate.

### 🖼️ Remote Desktop (`/desktop`)
- A full XFCE desktop delivered over Ubuntu's standard **XRDP** service and
  rendered in-browser via Guacamole. Keyboard and mouse are forwarded; use
  **Reconnect** to renegotiate the display size. The view scales to fit your
  window.
- **Open only one desktop tab per account at a time.** Each tab is a separate
  RDP client, and XRDP bumps the older session when a second one connects
  (it appears as `Manually logged off` in the guacd logs), which can leave a
  tab blank. Close extra tabs and use **Reconnect**.

---

## Configuration

All settings are environment variables (see `docker-compose.yml`).

| Variable            | Default            | Description |
|---------------------|--------------------|-------------|
| `PORT`              | `8080`             | Web dashboard listen port |
| `HOST`              | `0.0.0.0`          | Web dashboard bind address |
| `DEFAULT_USER`      | *(unset)*          | Convenience account created on boot |
| `DEFAULT_PASSWORD`  | *(unset)*          | Password for `DEFAULT_USER` |
| `CODE_SERVER_USER`  | `DEFAULT_USER`/root| Account code-server runs as |
| `ALLOW_ROOT_LOGIN`  | `false`            | Permit `root` to sign in |
| `MIN_LOGIN_UID`     | `1000`             | Minimum uid allowed to sign in |
| `SESSION_SECRET`    | random each boot   | Cookie signing secret — pin it to keep sessions across restarts |
| `GUAC_CRYPT_KEY`    | random each boot   | Passphrase for desktop tokens — pin it too |
| `PAM_SERVICE`       | `ubws`             | PAM service name used for auth |
| `TZ`                | *(host)*           | Server time zone |
| `RDP_HOST`/`RDP_PORT` | `127.0.0.1`/`3389` | Where XRDP listens |
| `GUACD_HOST`/`GUACD_PORT` | `127.0.0.1`/`4822` | Where guacd listens |
| `CODE_SERVER_HOST`/`CODE_SERVER_PORT` | `127.0.0.1`/`8443` | code-server address |
| `MAX_UPLOAD_BYTES`  | `5368709120` (5 GB)| Per-file upload limit |

---

## Use cases

- **Headless home server / NAS:** manage files, run commands, and pop open a
  desktop from your laptop without installing an SSH or RDP client.
- **Shared lab or classroom box:** everyone signs in with their own account and
  gets an isolated home directory, terminal, and editor from a Chromebook or
  tablet.
- **Remote development:** open Web VS Code against code that lives on a powerful
  build machine; use the terminal for builds and the file browser to shuttle
  artifacts.
- **Occasional GUI work:** reach a graphical app on the server (browser, IDE,
  design tool) through the XRDP desktop without a local RDP client.
- **Locked-down kiosks / thin clients:** a device with only a browser becomes a
  full workstation on the LAN.

---

## Security notes

This project is designed for a **trusted LAN**. Before wider exposure:

- **Serve it over HTTPS.** Put a reverse proxy (Caddy, nginx, Traefik) with TLS
  in front, or terminate TLS at your load balancer. The session cookie is set to
  `secure: auto`, so it upgrades automatically behind an HTTPS proxy.
- **Pin `SESSION_SECRET` and `GUAC_CRYPT_KEY`** so tokens/sessions survive
  restarts and aren't guessable.
- **Remove the demo account** (`DEFAULT_USER`/`DEFAULT_PASSWORD`) and use real
  host accounts.
- Keep `ALLOW_ROOT_LOGIN=false`.
- The container runs privileged services (sshd, xrdp) as root internally, which
  is required to authenticate arbitrary users and start desktop sessions. Treat
  the container as you would a login server.
- Do not expose port `8080` directly to the public internet without TLS and,
  ideally, an additional access control layer (VPN, mTLS, SSO gateway).

---

## Troubleshooting

- **Login fails for a valid account.** Confirm the account exists *inside the
  container* (or that you mounted `/etc/passwd` + `/etc/shadow`). Check
  `docker logs ubuntu-web-dashboard` and `docker exec … cat /var/log/supervisor/dashboard.log`.
- **Terminal/desktop tab is blank.** These need the vendored browser bundles
  (`public/vendor/*`), which are produced by `npm install`'s postinstall step
  during the image build. Rebuild with `--no-cache` if you edited dependencies.
- **Remote Desktop won't connect.** Check `xrdp`/`xrdp-sesman` logs in the app
  container (`/var/log/supervisor/`) and the guacd sidecar
  (`docker logs ubuntu-web-guacd`). Confirm the guacd container can reach the
  app container's XRDP — they must share a Docker network and `RDP_HOST` must be
  the app service's name (`ubuntu-web-dashboard`). XRDP needs the extra
  `shm_size`/`SYS_PTRACE` from the compose file.
- **Remote Desktop connects but shows a black/blank screen.** The XFCE session
  failed to start. This is handled by `/etc/xrdp/startwm.sh` (sets
  `XDG_RUNTIME_DIR` + a session D-Bus) and `/etc/X11/Xwrapper.config`
  (`allowed_users=anybody`) baked into the image. If you still see black,
  inspect the per-session logs inside the app container as the logged-in user:
  `~/.xorgxrdp.*.log`, `~/.xsession-errors`, and
  `docker exec ubuntu-web-dashboard cat /var/log/supervisor/xrdp-sesman.log`.
  A quick sanity check that the desktop is installed: `which startxfce4`.
- **Web VS Code shows a proxy error briefly after boot.** code-server takes a
  few seconds to start; refresh. If assets misbehave behind a subpath, front the
  app with a dedicated hostname instead of the `/vscode` subpath.
- **Wrong time on the server clock.** Set `TZ` (e.g. `-e TZ=America/New_York`).

Handy log locations inside the container: `/var/log/supervisor/`.

---

## Development (running without Docker)

The app can run directly on an Ubuntu host for development (the PAM, PTY, and
XRDP features require the corresponding system packages and, in practice, root):

```bash
sudo apt-get install -y build-essential python3 libpam0g-dev
npm install
sudo PORT=8080 DEFAULT_USER=$USER npm start
```

Then browse to `http://localhost:8080`. code-server and xrdp must be installed
and running for those features, and a guacd instance must be reachable at
`GUACD_HOST:GUACD_PORT` for the desktop (the quickest way is
`docker run -d -p 4822:4822 guacamole/guacd:1.5.5` with `GUACD_HOST=127.0.0.1`).
The file browser and
terminal work with just Node + PAM.

Project layout:

```
src/            Node backend (server, auth, routes, websocket bridges)
public/         Static assets (css/js) + vendored browser libs
views/          HTML templates served only to authenticated users
docker/         entrypoint, supervisord, xrdp, PAM, code-server launcher
scripts/        postinstall vendor-bundle copier
Dockerfile      Single-image build
docker-compose.yml
```

---

## License

[MIT](./LICENSE) © 2026 aashiquear

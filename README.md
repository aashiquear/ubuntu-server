# 🐧 Ubuntu Web Dashboard

A dashboard that turns an Ubuntu server (targeting **Ubuntu 26.04**) into a
workspace you can reach from any machine on the same LAN using nothing but a
**web browser**.

Sign in with your **existing system / SSH account** and get, each in its own
browser tab and all running on the server:

- 📁 **File Browser** — browse your home directory with drag-and-drop upload & download
- 💻 **Terminal** — a full interactive shell, running as you
- 🧩 **Web VS Code** — a stable build of VS Code (code-server) on the server
- 🖼️ **Remote Desktop** — a full graphical desktop over **XRDP**, rendered in the browser

The landing page also shows a welcome note and **two live clocks** — one for the
server and one for your browser — so time-zone differences are always visible.

## Two ways to run it — pick based on what you want

| | **Native install** (recommended) | **Docker** (self-contained sandbox) |
|---|---|---|
| Terminal / files / VS Code | The **real host** — your accounts, home dirs, files | Inside the container (isolated) |
| Remote Desktop | The **host's own desktop with every installed app** | A minimal XFCE desktop *inside the container* |
| Best for | Actually working on the server machine | A quick, throwaway, isolated demo |
| Setup | `sudo ./scripts/install-host.sh` | `docker compose up -d --build` |

> If your goal is to reach the **real server and its installed applications**,
> use the **native install**. A container is sandboxed by design, so its
> desktop/terminal only see what's *in the container*, not the host.

---

## Table of contents

- [How it works](#how-it-works)
- [Install natively on the server (recommended)](#install-natively-on-the-server-recommended)
- [Requirements](#requirements)
- [Quick start (Docker sandbox)](#quick-start-docker-sandbox)
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

The diagram above shows the **Docker sandbox**. In a **native install** the
exact same Node app runs directly on the host (as a systemd service) instead of
in a container, so `node-pty`, the file API, the `/vscode` proxy, and the
desktop bridge all target the host's own shell, home directories, code-server,
and XRDP — i.e. the real machine and its installed apps.

---

## Install natively on the server (recommended)

This is the way to get **real access to the server and its installed apps**.
Run it directly on the Ubuntu machine you want to reach:

```bash
git clone https://github.com/aashiquear/ubuntu-server.git
cd ubuntu-server
sudo ./scripts/install-host.sh
```

The installer:

- installs Node.js, build tools, **XRDP**, and **code-server** on the host;
- sets up the `ubws` PAM service (sign-in uses real system/SSH accounts);
- runs `guacd` via Docker for the desktop bridge (if Docker is present);
- writes `/etc/ubuntu-web-dashboard.env` (generated secrets, host wiring);
- installs and starts systemd services: `ubuntu-web-dashboard`,
  `ubuntu-web-guacd`, and `code-server@<user>`.

Then open `http://<server-ip>:8080` and sign in with any account that can SSH
into the box. Because everything runs on the host:

- **Terminal** is a real shell on the server with every installed CLI tool.
- **File Browser** shows your actual home directory.
- **Web VS Code** edits the real filesystem.
- **Remote Desktop** is a full session on the host's own desktop environment,
  with **all installed applications**.

Manage or remove it with:

```bash
journalctl -u ubuntu-web-dashboard -f     # logs
sudo systemctl restart ubuntu-web-dashboard
sudo ./scripts/uninstall-host.sh          # remove the services
```

### Remote Desktop on a real host — important notes

- XRDP opens a **new login session** (with all your apps), not a mirror of the
  physical monitor. To share the exact screen on the monitor instead, use VNC
  to display `:0` or GNOME Remote Desktop — a different mechanism.
- **GNOME allows only one session per user.** If the same account is already
  logged in on the server's physical screen, log it out first, or connect with
  a different account. Desktop environments like XFCE/MATE don't have this
  limit and tend to be the smoothest over XRDP.
- If a GNOME-over-XRDP session is black or drops immediately, installing a
  lightweight DE for remote use is the usual fix:
  `sudo apt install xfce4 xfce4-goodies` and set it as the session (e.g. put
  `xfce4-session` in `~/.xsession`).

---

## Requirements

**Native install:** an Ubuntu host (24.04+/26.04), root access, and Docker
present *if you want the Remote Desktop feature* (used only to run `guacd`).

**Docker sandbox:** a machine running Docker + Docker Compose, and network
reachability from the LAN to port `8080`. For the desktop, allow the container
the modest extra privileges in `docker-compose.yml` (`shm_size`, `SYS_PTRACE`).

> **Note on the base image:** the Docker image is built `FROM ubuntu:26.04`. If
> that tag is not yet published in your registry, change the first line of the
> `Dockerfile` to `ubuntu:24.04` — everything else is identical.

---

## Quick start (Docker sandbox)

> Reminder: the Docker path is a **self-contained sandbox** — its terminal,
> files, and desktop live *inside the container*, not on the host. For access to
> the real server and its apps, use the [native install](#install-natively-on-the-server-recommended).

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
- A full desktop delivered over Ubuntu's standard **XRDP** service and rendered
  in-browser via Guacamole. In a **native install** this is the host's own
  desktop environment with **all installed applications**; in the **Docker
  sandbox** it's a minimal XFCE desktop inside the container. Keyboard and mouse
  are forwarded; use **Reconnect** to renegotiate the display size, and the view
  scales to fit your window.
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
systemd/        service units for the native host install
scripts/        install-host.sh / uninstall-host.sh + vendor-bundle copier
Dockerfile      Single-image build (sandbox)
docker-compose.yml
```

---

## License

[MIT](./LICENSE) © 2026 aashiquear

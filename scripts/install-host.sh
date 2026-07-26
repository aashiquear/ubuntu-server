#!/usr/bin/env bash
#
# Native host installer for the Ubuntu Web Dashboard.
#
# Installs and runs the dashboard directly on THIS server (not in a container),
# so the terminal, file browser, Web VS Code, and XRDP desktop all reflect the
# real machine: its accounts, home directories, and installed applications.
#
#   Usage:  sudo ./scripts/install-host.sh
#
# Optional environment overrides:
#   PORT=8080                 dashboard port
#   CODE_SERVER_USER=<user>   account code-server runs as (default: your sudo user)
#
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root:  sudo $0" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE=/etc/ubuntu-web-dashboard.env
PORT="${PORT:-8080}"
CODE_SERVER_USER="${CODE_SERVER_USER:-${SUDO_USER:-root}}"

echo "==> Ubuntu Web Dashboard — native host install"
echo "    repo dir:         $REPO_DIR"
echo "    port:             $PORT"
echo "    code-server user: $CODE_SERVER_USER"
echo

export DEBIAN_FRONTEND=noninteractive

# --- 1. System packages ---------------------------------------------------
echo "==> Installing base packages..."
apt-get update
# XRDP plus the XFCE desktop it launches. startwm.sh (installed below) always
# exec's `startxfce4`, so the XFCE stack MUST be present or the session dies the
# instant it starts — the browser shows "connected, then disconnected". On a
# stock Ubuntu Desktop (GNOME) — e.g. 24.04 — XFCE is not installed by default,
# so we install it here rather than assuming the host already has it. These are
# the same desktop packages the Docker image installs (see Dockerfile), keeping
# the host and container sessions identical. dbus-x11/xauth give the session a
# message bus and X authority even when it isn't started under a full systemd
# user session.
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg openssl \
  build-essential python3 libpam0g-dev \
  xrdp xorgxrdp dbus-x11 xauth \
  xfce4 xfce4-terminal xfce4-goodies

# Node.js >= 18
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 18 ]; then
  echo "==> Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y --no-install-recommends nodejs
fi

# code-server (Web VS Code)
if ! command -v code-server >/dev/null 2>&1; then
  echo "==> Installing code-server..."
  curl -fsSL https://code-server.dev/install.sh | sh
fi

# --- 2. PAM service -------------------------------------------------------
echo "==> Installing PAM service 'ubws'..."
install -m0644 "$REPO_DIR/docker/pam/ubws" /etc/pam.d/ubws

# --- 3. XRDP (uses the host's own default desktop session) ----------------
echo "==> Enabling XRDP..."
adduser xrdp ssl-cert >/dev/null 2>&1 || true
systemctl enable xrdp xrdp-sesman >/dev/null 2>&1 || true

# Choose a port XRDP can actually bind. On Ubuntu Desktop, GNOME Remote Desktop
# (or its leftover user-mode daemon) often listens on 3389/3390 with a
# security layer our PAM single sign-on can't traverse. We do NOT touch that
# service here — we just pick the first free port in a small range so the
# two daemons can coexist. The range is intentionally narrow so the operator
# can still find XRDP from the host's firewall / SSH-tunnel.
XRDP_PORT=""
# A second daemon (e.g. gnome-remote-desktop) can grab a port between our
# scan and xrdp's bind(). Re-scan at most 3 times with a brief pause; if it
# keeps stealing ports, give up and let the operator decide.
for attempt in 1 2 3 4 5; do
  for cand in 3389 3390 3391 3392 3393; do
    if ! ss -ltnH "sport = :$cand" 2>/dev/null | grep -q .; then
      XRDP_PORT="$cand"
      break 2
    fi
  done
  sleep 1
done
if [ -z "$XRDP_PORT" ]; then
  echo "!!  None of the candidate RDP ports (3389-3393) stayed free." >&2
  echo "!!  Listeners currently bound:" >&2
  ss -ltnHp 'sport = :3389 or sport = :3390 or sport = :3391 or sport = :3392 or sport = :3393' 2>/dev/null >&2 || true
  echo "!!  Free one of them (e.g. stop the conflicting service) and re-run." >&2
  exit 1
fi
# Only rewrite the [Globals] `port=` line. /etc/xrdp/xrdp.ini has the same
# key (`port=`) in the per-session blocks ([Xorg], [Xvnc], [vnc-any],
# [neutrinordp-any]) where it means the *sesman* port the session module
# connects to (normally `-1` for sesman-allocated displays, or `ask5900` /
# `ask3389` for the dynamic ones). A naive `sed 's/^port=.../.../'` rewrites
# every match and silently breaks session startup ("Error connecting to user
# session" in the xrdp log), because the per-session ports end up pointing
# at 3389 (the RDP listening port) instead of sesman. Scope the rewrites
# to the section they belong to, and also restore the dpkg defaults in the
# per-session blocks in case a previous install run clobbered them.
awk -v target="$XRDP_PORT" '
  /^\[Globals\]/ { in_globals=1; print; next }
  /^\[Xorg\]/            { in_globals=0; in_block="Xorg";            print; next }
  /^\[Xvnc\]/            { in_globals=0; in_block="Xvnc";            print; next }
  /^\[vnc-any\]/         { in_globals=0; in_block="vnc-any";         print; next }
  /^\[neutrinordp-any\]/ { in_globals=0; in_block="neutrinordp-any"; print; next }
  /^\[/                  { in_globals=0; in_block="";                print; next }
  in_globals && /^port=/ { sub(/^port=.*/, "port=" target) }
  in_block == "Xorg"            && /^port=/ { sub(/^port=.*/, "port=-1") }
  in_block == "Xvnc"            && /^port=/ { sub(/^port=.*/, "port=-1") }
  in_block == "vnc-any"         && /^port=/ { sub(/^port=.*/, "port=ask5900") }
  in_block == "neutrinordp-any" && /^port=/ { sub(/^port=.*/, "port=ask3389") }
  { print }
' /etc/xrdp/xrdp.ini > /etc/xrdp/xrdp.ini.new \
  && mv /etc/xrdp/xrdp.ini.new /etc/xrdp/xrdp.ini

systemctl restart xrdp xrdp-sesman >/dev/null 2>&1 || true

# Verify XRDP actually came up. Without this check, a bind conflict (e.g. a
# process grabbing the port after our probe) would silently leave the env
# file pointing at a dead XRDP — guacd would then connect to whatever IS
# listening on that port and fail with "wrong security type" at runtime.
#
# Two checks: (1) the service is active, and (2) *something* is listening on
# the chosen port. We deliberately don't require the listener to be labeled
# "xrdp" in `ss -p` because that label only appears when `ss` runs as root
# with CAP_NET_ADMIN; a plain root shell always has it, but a tightly-locked
# one (e.g. systemd ProtectKernelTuning) might not. The pair of checks is
# strong enough: if xrdp is dead (1) catches it; if xrdp restarted but
# someone else grabbed the port, (2) catches it.
#
# `systemctl is-active` can return `active` *during* the start transaction,
# before xrdp has actually bound the socket. Wait a few seconds for the bind
# to land before checking.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ss -ltnH "sport = :$XRDP_PORT" 2>/dev/null | grep -q .; then
    break
  fi
  sleep 0.5
done
if ! systemctl is-active --quiet xrdp; then
  echo "!!  xrdp.service failed to start." >&2
  journalctl -u xrdp --no-pager -n 20 >&2 || true
  exit 1
fi
if ! ss -ltnH "sport = :$XRDP_PORT" 2>/dev/null | grep -q .; then
  echo "!!  xrdp is running but is NOT listening on $XRDP_PORT." >&2
  ss -ltnH "sport = :$XRDP_PORT" 2>/dev/null >&2 || true
  journalctl -u xrdp --no-pager -n 20 >&2 || true
  exit 1
fi
echo "==> XRDP is listening on port $XRDP_PORT."

# Install our own startwm.sh. The dpkg default exec's /etc/X11/Xsession,
# which honours the user's ~/.xsession. If that file contains a bare
# `xfce4-session` (a common pattern on Ubuntu desktop installs) and the
# user's ~/.config/xfce4/xfconf/.../xfce4-session.xml is stale or has a
# SessionName that doesn't match any defined session, xfce4-session
# starts the panel/desktop but never starts the window manager, leaving
# the user staring at a frozen / non-interactive desktop. Launching
# startxfce4 directly (the way the container does) bypasses ~/.xsession
# and the XFCE session store entirely, so we always get a working window
# manager. systemd is already providing the per-user XDG_RUNTIME_DIR
# and the session D-Bus, so we don't need the dbus-launch wrapper.
echo "==> Installing /etc/xrdp/startwm.sh..."
cat > /etc/xrdp/startwm.sh <<'EOF'
#!/bin/sh
# Ubuntu Web Dashboard — startwm.sh for XRDP on the host.
#
# xrdp-sesexec runs this as the logged-in user with DISPLAY=:N. We launch
# startxfce4 directly (bypassing /etc/X11/Xsession and ~/.xsession) so
# xfwm4 is always started. See the comment in scripts/install-host.sh
# for the bug this avoids.
if [ -r /etc/profile ]; then
  . /etc/profile
fi
if [ -r "$HOME/.profile" ]; then
  . "$HOME/.profile"
fi
export XDG_SESSION_DESKTOP=xfce
export XDG_CURRENT_DESKTOP=XFCE
export XDG_SESSION_TYPE=x11
export DESKTOP_SESSION=xfce
# Disable xfwm4's compositor: the headless AMD/Intel GPU stack on this
# host uses llvmpipe, which xfwm4's compositor rejects ("Unsupported GL
# renderer"), leaving a black screen. The /etc/xdg default covers fresh
# users, but a persistent home may already have compositing on.
(
  i=0
  while [ "$i" -lt 10 ]; do
    if xfconf-query -c xfwm4 -p /general/use_compositing -n -t bool -s false 2>/dev/null; then
      break
    fi
    i=$((i + 1))
    sleep 1
  done
) &
# Launch XFCE. The installer guarantees the XFCE packages are present, but be
# defensive: if startxfce4 somehow isn't on PATH, fall back to the host's
# default X session (/etc/X11/Xsession honours ~/.xsession) rather than exiting
# immediately — a silent exit here is what the browser reports as
# "connected, then disconnected".
if command -v startxfce4 >/dev/null 2>&1; then
  exec startxfce4
elif [ -x /etc/X11/Xsession ]; then
  exec /etc/X11/Xsession
else
  echo "startwm.sh: no desktop session available (startxfce4 missing)" >&2
  exit 1
fi
EOF
chmod 0755 /etc/xrdp/startwm.sh

# Allow Xorg to start for non-console users. /etc/X11/Xwrapper.config
# defaults to `allowed_users=console`, which makes Xorg.wrap refuse every
# RDP session ("Xorg: Only console users are allowed to run the X server",
# surfaced in xrdp's log as "Error connecting to user session"). Bump it to
# `anybody` so xrdp's per-user X server can come up. This is the same
# setting the xrdp snap and most other "headless X" recipes ship.
if [ -f /etc/X11/Xwrapper.config ] && \
   ! grep -qE '^\s*allowed_users=anybody' /etc/X11/Xwrapper.config 2>/dev/null; then
  echo "==> Setting Xwrapper to allowed_users=anybody (xrdp needs it)..."
  sed -i 's/^\s*allowed_users=.*/allowed_users=anybody/' /etc/X11/Xwrapper.config
  # If the line wasn't there at all, append it.
  if ! grep -qE '^\s*allowed_users=anybody' /etc/X11/Xwrapper.config; then
    echo "allowed_users=anybody" >> /etc/X11/Xwrapper.config
  fi
fi

# Disable xfwm4 compositing by default for every new user. The container
# renders with the llvmpipe software GL driver, which xfwm4's compositor
# rejects — leaving a black screen. The same driver is what a typical
# headless host uses too (no discrete GPU available to the RDP session).
install -d /etc/xdg/xfce4/xfconf/xfce-perchannel-xml
install -m 0644 "$REPO_DIR/docker/xfce/xfwm4.xml" \
  /etc/xdg/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml

# Allow RDP users to drive Xorg. xorgxrdp's default config
# (/etc/X11/xrdp/xorg.conf) opens /dev/dri/renderD128 for the per-user X
# server. On Ubuntu, /dev/dri/{card,renderD}* are root:video / root:render
# mode 0660 — without group membership, the per-user Xorg process started
# by xrdp-sesexec gets EACCES on the render node and exits within ~1 s,
# which surfaces in the xrdp log as "Xorg server closed connection" and
# in the browser as a fast connect→disconnect cycle (no useful frame).
# The standard fix on Ubuntu is to put every user that can RDP into
# `video` and `render` (idempotent — already-in users are a no-op).
getent group video  >/dev/null || groupadd -g 44 video
getent group render >/dev/null || groupadd -g 990 render
# Minimum UID the dashboard allows to sign in (matches src/config.js).
MIN_LOGIN_UID="${MIN_LOGIN_UID:-1000}"
while IFS=: read -r uname _ uid _ _ _ _; do
  if [ "$uid" -ge "$MIN_LOGIN_UID" ] && [ "$uid" -lt 65534 ]; then
    usermod -aG video,render "$uname" 2>/dev/null || true
  fi
done < /etc/passwd

# Wipe stale per-user XFCE session configs that prevent xfwm4 from
# starting. The container's startwm.sh doesn't hit this path, but the
# host's xfce4-session can be pointed at a SessionName (e.g. "Default")
# that has no matching <sessions> entry — in which case xfce4-session
# silently skips the window manager and the user gets a frozen desktop.
# Removing the corrupted channel file is safe: xfce4-session will
# regenerate it on next start.
echo "==> Clearing any stale XFCE session configs..."
while IFS=: read -r uname _ uid _ _ _ _; do
  if [ "$uid" -ge "$MIN_LOGIN_UID" ] && [ "$uid" -lt 65534 ]; then
    USER_HOME="$(getent passwd "$uname" | cut -d: -f6)"
    [ -d "$USER_HOME" ] || continue
    for f in \
      "$USER_HOME/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-session.xml" \
      "$USER_HOME/.cache/sessions/xfce4-session-$(hostname)" \
      "$USER_HOME/.cache/sessions/xfce4-session-$(hostname)rc"; do
      [ -f "$f" ] || continue
      rm -f "$f" && echo "    removed: $f"
    done
  fi
done < /etc/passwd

# --- 4. guacd (via Docker; not packaged on current Ubuntu) ----------------
GUACD_ENABLED=0
DOCKER_BIN="$(command -v docker || true)"
if [ -n "$DOCKER_BIN" ]; then
  echo "==> Installing guacd service (Docker at $DOCKER_BIN)..."
  # Pre-pull so the first service start doesn't race the image download.
  "$DOCKER_BIN" pull guacamole/guacd:1.5.5 || \
    echo "!!  Could not pre-pull guacd image; the service will pull on start."
  sed "s#__DOCKER__#$DOCKER_BIN#g" \
    "$REPO_DIR/systemd/ubuntu-web-guacd.service" \
    > /etc/systemd/system/ubuntu-web-guacd.service
  GUACD_ENABLED=1
else
  echo "!!  Docker not found. The Remote Desktop feature needs guacd."
  echo "    Install Docker (recommended) and re-run, or build guacamole-server"
  echo "    from source, then set GUACD_HOST/GUACD_PORT in $ENV_FILE."
fi

# --- 5. App dependencies (also vendors browser bundles) -------------------
echo "==> Installing app dependencies..."
( cd "$REPO_DIR" && npm install --omit=dev )

# --- 6. Environment file --------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  echo "==> Writing $ENV_FILE ..."
  cat > "$ENV_FILE" <<EOF
# Ubuntu Web Dashboard — native host configuration
NODE_ENV=production
PORT=$PORT
PAM_SERVICE=ubws
# Remote desktop bridges to this host's own XRDP. guacd runs in a Docker
# container and reaches the host via Docker's host-gateway, so RDP_HOST is the
# special name host.docker.internal (mapped to the host in the guacd service).
RDP_HOST=host.docker.internal
RDP_PORT=$XRDP_PORT
GUACD_HOST=127.0.0.1
GUACD_PORT=4822
# Web VS Code:
CODE_SERVER_HOST=127.0.0.1
CODE_SERVER_PORT=8443
# Secrets (generated once):
SESSION_SECRET=$(openssl rand -hex 32)
GUAC_CRYPT_KEY=$(openssl rand -hex 24)
# Set to true to permit root to sign in (not recommended):
ALLOW_ROOT_LOGIN=false
EOF
  chmod 600 "$ENV_FILE"
else
  echo "==> Keeping existing $ENV_FILE"
fi

# Ensure the host-wiring keys are correct even in a pre-existing env file
# (e.g. upgrading from an earlier version that set RDP_HOST=127.0.0.1).
set_env() {
  local key="$1" val="$2" file="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s#^${key}=.*#${key}=${val}#" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}
if [ "$GUACD_ENABLED" = "1" ]; then
  set_env RDP_HOST host.docker.internal "$ENV_FILE"
  set_env RDP_PORT "$XRDP_PORT" "$ENV_FILE"
  set_env GUACD_HOST 127.0.0.1 "$ENV_FILE"
  set_env GUACD_PORT 4822 "$ENV_FILE"
fi

# --- 7. code-server for the chosen user -----------------------------------
CS_HOME="$(getent passwd "$CODE_SERVER_USER" | cut -d: -f6 || true)"
if [ -n "$CS_HOME" ] && [ -d "$CS_HOME" ]; then
  echo "==> Configuring code-server for '$CODE_SERVER_USER'..."
  install -d -o "$CODE_SERVER_USER" -g "$CODE_SERVER_USER" "$CS_HOME/.config/code-server"
  cat > "$CS_HOME/.config/code-server/config.yaml" <<EOF
bind-addr: 127.0.0.1:8443
auth: none
cert: false
EOF
  chown "$CODE_SERVER_USER:$CODE_SERVER_USER" "$CS_HOME/.config/code-server/config.yaml"
  systemctl enable --now "code-server@$CODE_SERVER_USER" >/dev/null 2>&1 || \
    echo "!!  Could not start code-server@$CODE_SERVER_USER; check: journalctl -u code-server@$CODE_SERVER_USER"
else
  echo "!!  Home directory for '$CODE_SERVER_USER' not found; skipping code-server config."
fi

# --- 8. Dashboard systemd unit --------------------------------------------
echo "==> Installing dashboard service..."
sed -e "s#__REPO_DIR__#$REPO_DIR#g" \
    -e "s#__ENV_FILE__#$ENV_FILE#g" \
    "$REPO_DIR/systemd/ubuntu-web-dashboard.service" \
    > /etc/systemd/system/ubuntu-web-dashboard.service

systemctl daemon-reload
# enable + restart (not `enable --now`) so re-running the installer picks up
# updated unit files even when the service is already running.
if [ "$GUACD_ENABLED" = "1" ]; then
  systemctl enable ubuntu-web-guacd.service >/dev/null 2>&1 || true
  systemctl restart ubuntu-web-guacd.service || true
  sleep 3
  if "$DOCKER_BIN" ps --format '{{.Names}}' 2>/dev/null | grep -qx ubws-guacd; then
    echo "==> guacd is running."
  else
    echo "!!  guacd container is NOT running. Recent service logs:"
    journalctl -u ubuntu-web-guacd --no-pager -n 20 || true
    echo "!!  The Remote Desktop feature will not work until this is resolved."
  fi
fi
systemctl enable ubuntu-web-dashboard.service >/dev/null 2>&1 || true
systemctl restart ubuntu-web-dashboard.service

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "======================================================================"
echo " Ubuntu Web Dashboard is running."
echo "   URL:    http://${IP:-<server-ip>}:$PORT"
echo "   Login:  any account that can SSH into this server"
echo "   Logs:   journalctl -u ubuntu-web-dashboard -f"
echo
echo " Remote Desktop notes:"
echo "   * It opens a NEW desktop session (all installed apps available)."
echo "   * GNOME allows only one session per user: if the same account is"
echo "     already logged in on the physical monitor, either log that out"
echo "     first or use a separate account for remote."
echo "======================================================================"

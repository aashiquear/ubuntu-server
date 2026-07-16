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
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg openssl \
  build-essential python3 libpam0g-dev \
  xrdp xorgxrdp

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
systemctl enable --now xrdp xrdp-sesman >/dev/null 2>&1 || true

# --- 4. guacd (via Docker; not packaged on current Ubuntu) ----------------
GUACD_ENABLED=0
if command -v docker >/dev/null 2>&1; then
  echo "==> Installing guacd service (Docker)..."
  install -m0644 "$REPO_DIR/systemd/ubuntu-web-guacd.service" \
    /etc/systemd/system/ubuntu-web-guacd.service
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
# Remote desktop bridges to this host's own XRDP:
RDP_HOST=127.0.0.1
RDP_PORT=3389
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
  systemctl restart ubuntu-web-guacd.service || \
    echo "!!  guacd service failed to start; check: journalctl -u ubuntu-web-guacd"
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

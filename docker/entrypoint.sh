#!/bin/bash
# Container entrypoint: prepare runtime state, then hand off to supervisord
# (passed as CMD) which starts every service. Environment exported here is
# inherited by all supervised processes.
set -e

log() { echo "[entrypoint] $*"; }

# --- Secrets (generated once per container if not provided) ---------------
export SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"
export GUAC_CRYPT_KEY="${GUAC_CRYPT_KEY:-$(openssl rand -hex 24)}"

# --- Timezone -------------------------------------------------------------
if [ -n "$TZ" ] && [ -f "/usr/share/zoneinfo/$TZ" ]; then
  ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime
  echo "$TZ" > /etc/timezone
fi

# --- Runtime directories --------------------------------------------------
mkdir -p /var/run/sshd /run/dbus /var/log/supervisor /var/lib/dbus

# --- SSH host keys --------------------------------------------------------
ssh-keygen -A >/dev/null 2>&1 || true

# --- D-Bus machine id (XFCE/XRDP need it) ---------------------------------
if [ ! -s /var/lib/dbus/machine-id ]; then
  dbus-uuidgen > /var/lib/dbus/machine-id
fi
[ -s /etc/machine-id ] || cp /var/lib/dbus/machine-id /etc/machine-id

# --- Optional convenience account -----------------------------------------
# Create a ready-to-use account inside the container. For production you
# would instead mount real host accounts (see README "Using host SSH users").
if [ -n "$DEFAULT_USER" ]; then
  if ! id "$DEFAULT_USER" >/dev/null 2>&1; then
    log "creating account '$DEFAULT_USER'"
    useradd -m -s /bin/bash "$DEFAULT_USER"
    usermod -aG sudo "$DEFAULT_USER" || true
  fi
  if [ -n "$DEFAULT_PASSWORD" ]; then
    echo "$DEFAULT_USER:$DEFAULT_PASSWORD" | chpasswd
  fi
fi

# --- code-server runs as this account -------------------------------------
export CODE_SERVER_USER="${CODE_SERVER_USER:-${DEFAULT_USER:-root}}"
if id "$CODE_SERVER_USER" >/dev/null 2>&1; then
  HOMEDIR="$(getent passwd "$CODE_SERVER_USER" | cut -d: -f6)"
  mkdir -p "$HOMEDIR/.local/share/code-server" "$HOMEDIR/.config/code-server"
  chown -R "$CODE_SERVER_USER:$CODE_SERVER_USER" "$HOMEDIR/.local" "$HOMEDIR/.config" 2>/dev/null || true
fi

# --- XRDP permissions -----------------------------------------------------
# xrdp needs read access to the TLS snakeoil key.
adduser xrdp ssl-cert >/dev/null 2>&1 || true

log "starting services (host=$(hostname), PAM service=${PAM_SERVICE:-ubws})"
exec "$@"

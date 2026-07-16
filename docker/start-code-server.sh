#!/bin/bash
# Launch the shared code-server (Web VS Code) instance. It binds only to
# localhost with authentication disabled; the sole way to reach it is
# through the dashboard's authenticated /vscode reverse proxy.
set -e

USER_NAME="${CODE_SERVER_USER:-root}"
PORT="${CODE_SERVER_PORT:-8443}"

if ! id "$USER_NAME" >/dev/null 2>&1; then
  echo "code-server user '$USER_NAME' does not exist; falling back to root" >&2
  USER_NAME=root
fi

# Run as the target user via a login shell so HOME and PATH are correct.
exec su - "$USER_NAME" -c \
  "exec code-server --bind-addr 127.0.0.1:${PORT} --auth none --disable-telemetry --disable-update-check"

#!/usr/bin/env bash
#
# Removes the native host install of the Ubuntu Web Dashboard.
# Leaves xrdp, code-server, and the config/PAM files in place (see the note
# printed at the end for how to remove those too).
#
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root:  sudo $0" >&2
  exit 1
fi

echo "==> Stopping and disabling dashboard services..."
systemctl disable --now ubuntu-web-dashboard.service 2>/dev/null || true
systemctl disable --now ubuntu-web-guacd.service 2>/dev/null || true

rm -f /etc/systemd/system/ubuntu-web-dashboard.service
rm -f /etc/systemd/system/ubuntu-web-guacd.service
systemctl daemon-reload

echo
echo "Removed the dashboard and guacd services."
echo "Left in place (remove manually if you want them gone):"
echo "  * XRDP:        sudo apt-get remove --purge xrdp xorgxrdp"
echo "  * code-server: sudo systemctl disable --now code-server@<user>"
echo "  * config:      sudo rm /etc/ubuntu-web-dashboard.env /etc/pam.d/ubws"

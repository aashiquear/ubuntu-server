#!/bin/sh
# XRDP session startup: launch the XFCE desktop for each RDP login.
#
# Runs as the logged-in user. In a container there is no systemd/pam to set
# up a per-user runtime dir or a session D-Bus, so we do it here — otherwise
# XFCE comes up as a black screen (or not at all).
if [ -r /etc/profile ]; then
  . /etc/profile
fi
if [ -r "$HOME/.profile" ]; then
  . "$HOME/.profile"
fi

# Per-user XDG runtime dir (dbus, XFCE, etc. need it). /run/user/<uid> is not
# writable by the user without systemd, so use a user-owned path under /tmp.
if [ -z "$XDG_RUNTIME_DIR" ]; then
  XDG_RUNTIME_DIR="/tmp/runtime-$(id -un)"
fi
export XDG_RUNTIME_DIR
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

export XDG_SESSION_DESKTOP=xfce
export XDG_CURRENT_DESKTOP=XFCE
export XDG_SESSION_TYPE=x11
export DESKTOP_SESSION=xfce

# Force the window-manager compositor OFF for this session. The container
# renders with the llvmpipe software GL driver, which xfwm4's compositor
# rejects — leaving a black screen. The /etc/xdg default covers fresh users,
# but a persistent home may already have compositing enabled, so we also set
# it live here once xfconfd is up (retry until the session bus is ready).
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

# Launch XFCE inside its own session D-Bus so panels, settings daemon, etc.
# have a message bus to talk on.
exec dbus-launch --exit-with-session startxfce4

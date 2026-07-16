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

# Launch XFCE inside its own session D-Bus so panels, settings daemon, etc.
# have a message bus to talk on.
exec dbus-launch --exit-with-session startxfce4

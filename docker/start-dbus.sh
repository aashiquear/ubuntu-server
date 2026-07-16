#!/bin/bash
# Start the system D-Bus daemon robustly in a container. There is no systemd
# socket activation here, and a stale pid/socket from a previous start makes
# dbus-daemon exit 1 (which is what crash-looped under supervisor). Clean up
# first, ensure the runtime dir and machine-id exist, then run in foreground.
set -e

mkdir -p /run/dbus
rm -f /run/dbus/pid /run/dbus/system_bus_socket

if [ ! -s /var/lib/dbus/machine-id ]; then
  dbus-uuidgen > /var/lib/dbus/machine-id
fi
[ -s /etc/machine-id ] || cp /var/lib/dbus/machine-id /etc/machine-id

exec dbus-daemon --system --nofork --nopidfile

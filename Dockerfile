# Ubuntu Web Dashboard — a single, self-contained image that turns an
# Ubuntu server into a browser-accessible workspace (files, terminal,
# Web VS Code, and an XRDP desktop) gated by system (SSH) credentials.
FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PAM_SERVICE=ubws \
    PORT=8080

# --- System packages ------------------------------------------------------
# Grouped: base tools, build deps for native node modules (node-pty,
# authenticate-pam), SSH, the XRDP desktop stack, and supervisor to run
# everything.
#
# NOTE: guacd (the Guacamole proxy daemon that speaks RDP) is NOT installed
# here — recent Ubuntu releases no longer ship the guacamole-server packages.
# It runs instead as the official prebuilt `guacamole/guacd` sidecar
# container (see docker-compose.yml), which is Guacamole's recommended
# deployment and avoids a fragile FreeRDP source build.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg openssl sudo locales tzdata \
      build-essential python3 libpam0g-dev \
      openssh-server \
      xrdp xorgxrdp dbus-x11 \
      xfce4 xfce4-terminal xfce4-goodies \
      supervisor \
 && rm -rf /var/lib/apt/lists/*

# --- Node.js 20 -----------------------------------------------------------
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# --- code-server (stable Web VS Code) -------------------------------------
RUN curl -fsSL https://code-server.dev/install.sh | sh

WORKDIR /opt/ubws

# Install node dependencies first (better layer caching). postinstall copies
# the browser vendor bundles (xterm, guacamole-common-js) into public/vendor,
# so the public/ tree must be present before install.
COPY package.json ./
COPY scripts ./scripts
COPY public ./public
RUN npm install --omit=dev

# Application code + docker assets
COPY src ./src
COPY views ./views
COPY docker ./docker

# Wire up config that lives outside the app tree.
RUN install -m 0644 docker/pam/ubws /etc/pam.d/ubws \
 && install -m 0755 docker/xrdp/startwm.sh /etc/xrdp/startwm.sh \
 && install -m 0755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh \
 && install -m 0755 docker/start-code-server.sh /opt/ubws/docker/start-code-server.sh \
 && install -m 0644 docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf \
 && mkdir -p /var/log/supervisor

EXPOSE 8080
# Optional direct access: 3389 (RDP) and 22 (SSH). Everything is reachable
# through the browser on 8080, so these stay unpublished unless you want them.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

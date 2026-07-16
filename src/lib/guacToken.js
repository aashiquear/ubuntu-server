'use strict';

const crypto = require('crypto');
const config = require('./../config');

/**
 * Build an encrypted connection token in the exact format expected by
 * guacamole-lite (>=1.x). The browser receives an opaque token;
 * guacamole-lite decrypts it server-side and opens the RDP connection to
 * XRDP on the operator's behalf, so plaintext RDP credentials never travel
 * to (or through) the browser.
 *
 * The encoding below mirrors guacamole-lite's own Crypt.encrypt byte for
 * byte so its Crypt.decrypt is guaranteed to accept it: the ciphertext is
 * accumulated as a binary string and base64-encoded as a whole (encoding
 * update() and final() separately would misalign base64 boundaries).
 */
function base64encode(str, mode) {
  return Buffer.from(str, mode || 'ascii').toString('base64');
}

function buildDesktopToken({ username, password, width, height, dpi }) {
  const payload = {
    connection: {
      type: 'rdp',
      settings: {
        hostname: config.rdpHost,
        port: config.rdpPort,
        username,
        password,
        security: 'any',
        'ignore-cert': true,
        'enable-wallpaper': true,
        'resize-method': 'display-update',
        width: width || 1280,
        height: height || 720,
        dpi: dpi || 96,
      },
    },
  };

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(config.guacCipher, config.guacKey, iv);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'binary');
  encrypted += cipher.final('binary');

  const data = {
    iv: base64encode(iv),
    value: base64encode(encrypted, 'binary'),
  };
  return base64encode(JSON.stringify(data));
}

module.exports = { buildDesktopToken };

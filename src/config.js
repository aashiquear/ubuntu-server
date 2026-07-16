'use strict';

const crypto = require('crypto');
const os = require('os');

function bool(v, def) {
  if (v === undefined) return def;
  return String(v).toLowerCase() === 'true' || v === '1';
}

// The Guacamole token cipher requires a 32-byte key. We accept any
// passphrase from the environment and derive a stable 32-byte key from it
// with SHA-256 so operators don't have to worry about exact length.
const guacPassphrase =
  process.env.GUAC_CRYPT_KEY || 'change-me-guacamole-token-secret';
const guacKey = crypto.createHash('sha256').update(guacPassphrase).digest();

module.exports = {
  // Web listener
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '8080', 10),

  // Session
  sessionSecret:
    process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  sessionTtlMs: parseInt(process.env.SESSION_TTL_MS || String(12 * 3600 * 1000), 10),

  // PAM
  pamService: process.env.PAM_SERVICE || 'login',
  allowRootLogin: bool(process.env.ALLOW_ROOT_LOGIN, false),
  minUid: parseInt(process.env.MIN_LOGIN_UID || '1000', 10),

  // Guacamole / XRDP desktop
  guacKey,
  guacCipher: 'AES-256-CBC',
  guacdHost: process.env.GUACD_HOST || '127.0.0.1',
  guacdPort: parseInt(process.env.GUACD_PORT || '4822', 10),
  rdpHost: process.env.RDP_HOST || '127.0.0.1',
  rdpPort: parseInt(process.env.RDP_PORT || '3389', 10),

  // Web VS Code (code-server)
  codeServerHost: process.env.CODE_SERVER_HOST || '127.0.0.1',
  codeServerPort: parseInt(process.env.CODE_SERVER_PORT || '8443', 10),

  // Misc
  hostname: os.hostname(),
  isProd: process.env.NODE_ENV === 'production',
};

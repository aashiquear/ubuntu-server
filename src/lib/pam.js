'use strict';

const config = require('../config');

// authenticate-pam is a native addon. Load it lazily so the app can at
// least boot (and report a clear error) in a dev environment where the
// addon or PAM headers are unavailable.
let pam = null;
let loadError = null;
try {
  pam = require('authenticate-pam');
} catch (err) {
  loadError = err;
}

/**
 * Verify a username/password pair against the host PAM stack (the same
 * credentials used for SSH / console login).
 *
 * Resolves to true on success, false on bad credentials, and rejects
 * only for infrastructure problems (PAM addon missing, etc.).
 */
function authenticate(username, password) {
  return new Promise((resolve, reject) => {
    if (!pam) {
      return reject(
        new Error(
          'PAM authentication is unavailable: ' +
            (loadError ? loadError.message : 'authenticate-pam not loaded')
        )
      );
    }
    pam.authenticate(
      username,
      password,
      (err) => {
        if (err) {
          // A truthy err here means authentication failed (bad password,
          // expired account, etc.). Treat as a normal auth rejection.
          return resolve(false);
        }
        resolve(true);
      },
      { serviceName: config.pamService, remoteHost: 'localhost' }
    );
  });
}

module.exports = { authenticate, available: !!pam };

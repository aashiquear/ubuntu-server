'use strict';

const { execFile } = require('child_process');

/**
 * Look up a POSIX account via getent(1) so that features (terminal,
 * files, RDP) can run under the correct uid/gid and home directory.
 *
 * Returns null if the user does not exist on the system.
 */
function lookupUser(username) {
  return new Promise((resolve) => {
    // Basic sanity check to avoid passing anything odd to getent.
    if (!/^[a-z_][a-z0-9_-]*\$?$/i.test(username)) {
      return resolve(null);
    }
    execFile('getent', ['passwd', username], (err, stdout) => {
      if (err || !stdout) return resolve(null);
      // name:passwd:uid:gid:gecos:home:shell
      const parts = stdout.trim().split(':');
      if (parts.length < 7) return resolve(null);
      const shell = parts[6] || '/bin/bash';
      resolve({
        name: parts[0],
        uid: parseInt(parts[2], 10),
        gid: parseInt(parts[3], 10),
        gecos: parts[4] || '',
        home: parts[5] || `/home/${parts[0]}`,
        // Fall back to bash if the account has a nologin shell so the
        // in-browser terminal is still usable.
        shell: /nologin|false$/.test(shell) ? '/bin/bash' : shell,
      });
    });
  });
}

module.exports = { lookupUser };

'use strict';

let pty = null;
let loadError = null;
try {
  pty = require('node-pty');
} catch (err) {
  loadError = err;
}

/**
 * Attach a PTY to a websocket connection, spawning a login shell as the
 * authenticated user (correct uid/gid/home/env). The wire protocol is
 * JSON messages:
 *   client -> server: {type:'input', data} | {type:'resize', cols, rows}
 *   server -> client: {type:'data', data}  | {type:'exit', code}
 */
function attachTerminal(ws, user) {
  if (!pty) {
    ws.send(
      JSON.stringify({
        type: 'data',
        data:
          '\r\n\x1b[31mTerminal unavailable: node-pty failed to load (' +
          (loadError ? loadError.message : 'unknown') +
          ')\x1b[0m\r\n',
      })
    );
    ws.close();
    return;
  }

  const shell = user.shell || '/bin/bash';
  let term;
  try {
    term = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: user.home,
      uid: user.uid,
      gid: user.gid,
      env: {
        ...process.env,
        HOME: user.home,
        USER: user.name,
        LOGNAME: user.name,
        SHELL: shell,
        PWD: user.home,
        TERM: 'xterm-256color',
        // Drop anything server-specific that shouldn't leak into the shell.
        PORT: undefined,
        SESSION_SECRET: undefined,
        GUAC_CRYPT_KEY: undefined,
      },
    });
  } catch (err) {
    ws.send(JSON.stringify({ type: 'data', data: '\r\nFailed to start shell: ' + err.message + '\r\n' }));
    ws.close();
    return;
  }

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data }));
  });

  term.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
    ws.close();
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return;
    }
    if (msg.type === 'input') {
      term.write(msg.data);
    } else if (msg.type === 'resize') {
      const cols = Math.max(1, msg.cols | 0);
      const rows = Math.max(1, msg.rows | 0);
      try {
        term.resize(cols, rows);
      } catch (_) {
        /* ignore invalid sizes */
      }
    }
  });

  ws.on('close', () => {
    try {
      term.kill();
    } catch (_) {
      /* already gone */
    }
  });
}

module.exports = { attachTerminal };

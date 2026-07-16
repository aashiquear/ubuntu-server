'use strict';

const httpProxy = require('http-proxy');
const config = require('../config');

/**
 * Reverse proxy for the shared code-server (Web VS Code) instance.
 *
 * code-server runs on 127.0.0.1 with `--auth none` and is only reachable
 * through this proxy, which is itself gated by the dashboard session. The
 * `/vscode` path prefix is preserved end-to-end so code-server can derive
 * the correct web base for its asset URLs.
 */
const target = `http://${config.codeServerHost}:${config.codeServerPort}`;

const proxy = httpProxy.createProxyServer({
  target,
  ws: true,
  changeOrigin: true,
  xfwd: true,
});

proxy.on('error', (err, req, res) => {
  if (res && res.writeHead && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(
      'Web VS Code (code-server) is not reachable yet.\n' +
        'It may still be starting up — retry in a few seconds.\n\n' +
        'Detail: ' +
        err.message
    );
  } else if (req && req.socket) {
    try {
      req.socket.destroy();
    } catch (_) {
      /* noop */
    }
  }
});

function handleHttp(req, res) {
  proxy.web(req, res);
}

function handleUpgrade(req, socket, head) {
  proxy.ws(req, socket, head);
}

module.exports = { handleHttp, handleUpgrade };

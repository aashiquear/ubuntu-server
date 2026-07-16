'use strict';

const http = require('http');
const GuacamoleLite = require('guacamole-lite');
const config = require('./../config');

/**
 * Create a guacamole-lite server whose websocket upgrades we drive
 * ourselves so a single listening HTTP port can multiplex several ws paths
 * (terminal, code-server, and this desktop bridge).
 *
 * guacamole-lite always constructs a `ws` WebSocketServer. Passing
 * `{ noServer: true }` alone is rejected because the library merges a
 * default `port`, and `ws` forbids `port` + `noServer` together. Instead we
 * hand it a throwaway HTTP server that is never `listen()`ed: guacamole-lite
 * attaches its connection handling to it, but no traffic ever reaches that
 * server. We then call `guac.webSocketServer.handleUpgrade(...)` directly
 * from server.js's `upgrade` handler for the `/ws/guac` path.
 */
function createGuacServer() {
  const dummyServer = http.createServer();

  const websocketOptions = { server: dummyServer };
  const guacdOptions = { host: config.guacdHost, port: config.guacdPort };
  const clientOptions = {
    crypt: { cypher: config.guacCipher, key: config.guacKey },
    connectionDefaultSettings: {
      rdp: {
        security: 'any',
        'ignore-cert': true,
        'enable-wallpaper': true,
      },
    },
    // guacamole-lite log levels are numeric: 10=ERRORS, 20=NORMAL, 30=VERBOSE.
    log: { level: config.isProd ? 10 : 20 },
  };

  const guac = new GuacamoleLite(websocketOptions, guacdOptions, clientOptions);
  return guac;
}

module.exports = { createGuacServer };

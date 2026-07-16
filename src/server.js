'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');

const config = require('./config');
const pam = require('./lib/pam');
const { lookupUser } = require('./lib/users');
const { attachTerminal } = require('./lib/terminal');
const { buildDesktopToken } = require('./lib/guacToken');
const { createGuacServer } = require('./lib/guacServer');
const codeProxy = require('./lib/codeProxy');
const filesRouter = require('./routes/files');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VIEWS_DIR = path.join(__dirname, '..', 'views');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

const sessionParser = session({
  name: 'ubws.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.sessionTtlMs,
    // secure cookies require HTTPS; leave off for plain-LAN HTTP unless a
    // TLS terminator sets X-Forwarded-Proto (trust proxy handles that).
    secure: 'auto',
  },
});

app.use(cookieParser());
app.use(sessionParser);

// ---- Auth helpers ---------------------------------------------------------

function requireAuthPage(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

function requireAuthApi(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// ---- Auth routes ----------------------------------------------------------

app.post('/login', express.urlencoded({ extended: false }), express.json(), async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const wantsJson = req.accepts(['html', 'json']) === 'json' || req.is('application/json');

  const fail = (msg, code = 401) => {
    if (wantsJson) return res.status(code).json({ error: msg });
    return res.redirect('/login?error=' + encodeURIComponent(msg));
  };

  if (!username || !password) return fail('Username and password are required');

  try {
    const ok = await pam.authenticate(username, password);
    if (!ok) return fail('Invalid username or password');

    const user = await lookupUser(username);
    if (!user) return fail('Account has no system profile');
    if (user.uid === 0 && !config.allowRootLogin) {
      return fail('Root login is disabled', 403);
    }
    if (user.uid !== 0 && user.uid < config.minUid) {
      return fail('System accounts cannot sign in', 403);
    }

    req.session.regenerate((err) => {
      if (err) return fail('Session error', 500);
      req.session.user = {
        name: user.name,
        uid: user.uid,
        gid: user.gid,
        home: user.home,
        shell: user.shell,
        gecos: user.gecos,
      };
      // Kept server-side only, used to open the RDP desktop on the user's
      // behalf. Never exposed through any API response.
      req.session.rdpPassword = password;
      req.session.save(() => {
        if (wantsJson) return res.json({ ok: true });
        return res.redirect('/');
      });
    });
  } catch (err) {
    return fail('Authentication is unavailable: ' + err.message, 500);
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ubws.sid');
    res.redirect('/login');
  });
});

// ---- API ------------------------------------------------------------------

app.get('/api/me', requireAuthApi, (req, res) => {
  const u = req.session.user;
  res.json({
    username: u.name,
    displayName: u.gecos && u.gecos.split(',')[0] ? u.gecos.split(',')[0] : u.name,
    home: u.home,
    hostname: config.hostname,
    serverTime: Date.now(),
    serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    features: {
      files: true,
      terminal: true,
      vscode: true,
      desktop: true,
    },
  });
});

app.get('/api/desktop/token', requireAuthApi, (req, res) => {
  const u = req.session.user;
  const width = parseInt(req.query.width, 10) || 1280;
  const height = parseInt(req.query.height, 10) || 720;
  const dpi = parseInt(req.query.dpi, 10) || 96;
  const token = buildDesktopToken({
    username: u.name,
    password: req.session.rdpPassword,
    width,
    height,
    dpi,
  });
  res.json({ token });
});

app.use('/api/files', requireAuthApi, filesRouter);

// ---- Web VS Code proxy (path prefix preserved) ---------------------------

app.all(['/vscode', '/vscode/*'], requireAuthPage, (req, res) => {
  codeProxy.handleHttp(req, res);
});

// ---- Pages ----------------------------------------------------------------

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(VIEWS_DIR, 'login.html'));
});
app.get('/', requireAuthPage, (req, res) => res.sendFile(path.join(VIEWS_DIR, 'dashboard.html')));
app.get('/files', requireAuthPage, (req, res) => res.sendFile(path.join(VIEWS_DIR, 'files.html')));
app.get('/terminal', requireAuthPage, (req, res) => res.sendFile(path.join(VIEWS_DIR, 'terminal.html')));
app.get('/desktop', requireAuthPage, (req, res) => res.sendFile(path.join(VIEWS_DIR, 'desktop.html')));

// Static assets (css/js/vendor). Served after routes so it can't shadow them.
app.use(express.static(PUBLIC_DIR));

// ---- HTTP server + websocket multiplexing --------------------------------

const server = http.createServer(app);

// guacamole-lite + terminal both run in noServer mode; we dispatch upgrades
// by path so a single listening port serves everything.
const guac = createGuacServer();
const terminalWss = new WebSocketServer({ noServer: true });

function fakeRes() {
  // Minimal response stub so express-session can run during `upgrade`
  // (where there is no real ServerResponse). We only read the session.
  return {
    headersSent: false,
    setHeader() {},
    getHeader() {},
    removeHeader() {},
    writeHead() {},
    write() {},
    end() {},
    on() {},
    once() {},
    emit() {},
  };
}

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch (_) {
    return socket.destroy();
  }

  sessionParser(req, fakeRes(), () => {
    const user = req.session && req.session.user;
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }

    if (pathname === '/vscode' || pathname.startsWith('/vscode/')) {
      return codeProxy.handleUpgrade(req, socket, head);
    }
    if (pathname === '/ws/terminal') {
      return terminalWss.handleUpgrade(req, socket, head, (ws) => {
        attachTerminal(ws, user);
      });
    }
    if (pathname === '/ws/guac' || pathname.startsWith('/ws/guac')) {
      return guac.webSocketServer.handleUpgrade(req, socket, head, (ws) => {
        guac.webSocketServer.emit('connection', ws, req);
      });
    }
    socket.destroy();
  });
});

server.listen(config.port, config.host, () => {
  console.log(`Ubuntu Web Dashboard listening on http://${config.host}:${config.port}`);
  console.log(`  host: ${config.hostname}`);
  console.log(`  PAM service: ${config.pamService} (available: ${pam.available})`);
  console.log(`  guacd: ${config.guacdHost}:${config.guacdPort}  rdp: ${config.rdpHost}:${config.rdpPort}`);
  console.log(`  code-server: ${config.codeServerHost}:${config.codeServerPort}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));

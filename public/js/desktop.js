(function () {
  const displayEl = document.getElementById('display');
  const overlay = document.getElementById('overlay');
  const overlayText = document.getElementById('overlay-text');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');

  function setStatus(cls, text) {
    statusEl.className = 'status ' + cls;
    statusText.textContent = text;
  }
  function showOverlay(text) { overlayText.textContent = text; overlay.style.display = 'grid'; }
  function hideOverlay() { overlay.style.display = 'none'; }
  // Plain console logging (NOT eval) so it works even under a strict CSP.
  function log() {
    try { console.log.apply(console, ['[desktop]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  let client = null;
  let keyboard = null;
  let display = null;
  let gotFrame = false;
  let watchdog = null;

  async function connect() {
    hideOverlay();
    setStatus('', 'Connecting…');
    showOverlay('Starting remote desktop…');

    if (typeof Guacamole === 'undefined') {
      setStatus('closed', 'Client not loaded');
      showOverlay('The Guacamole browser client failed to load. Run `npm install` so the vendor bundle is present.');
      return;
    }

    const rect = displayEl.getBoundingClientRect();
    const dpi = Math.round(96 * (window.devicePixelRatio || 1));
    const width = Math.max(640, Math.floor(rect.width));
    const height = Math.max(480, Math.floor(rect.height));
    log('container', width + 'x' + height, 'dpi', dpi);

    let token;
    try {
      const res = await fetch(
        '/api/desktop/token?width=' + width + '&height=' + height + '&dpi=' + dpi,
        { credentials: 'same-origin' }
      );
      if (res.status === 401) { location.href = '/login'; return; }
      token = (await res.json()).token;
      log('token received, length', token && token.length);
    } catch (e) {
      setStatus('closed', 'Token error');
      showOverlay('Could not obtain a desktop session token.');
      return;
    }

    const tunnel = new Guacamole.WebSocketTunnel('/ws/guac');
    tunnel.onstatechange = function (s) { log('tunnel state', s); };
    tunnel.onerror = function (status) {
      log('tunnel error', status && status.code, status && status.message);
    };

    client = new Guacamole.Client(tunnel);
    display = client.getDisplay();

    displayEl.innerHTML = '';
    displayEl.appendChild(display.getElement());

    display.onresize = function (w, h) { log('remote resize', w + 'x' + h); fit(); };

    client.onstatechange = function (state) {
      // 0:idle 1:connecting 2:waiting 3:connected 4:disconnecting 5:disconnected
      log('client state', state);
      if (state === 3) {
        setStatus('connected', 'Connected');
        hideOverlay();
        clearTimeout(watchdog);
        watchdog = setTimeout(function () {
          if (!gotFrame) {
            log('WARNING: connected but no frame received after 4s');
            showOverlay('Connected, but no image received yet.\nClick the desktop or press Reconnect. If it stays blank, only one desktop tab may be open at a time.');
          }
        }, 4000);
      } else if (state === 1 || state === 2) {
        setStatus('', 'Connecting…');
      } else if (state === 5) {
        setStatus('closed', 'Disconnected');
        showOverlay('The remote desktop session has ended.');
      }
    };

    client.onerror = function (err) {
      log('client error', err && err.code, err && err.message);
      setStatus('closed', 'Error');
      showOverlay('Remote desktop error: ' + (err && err.message ? err.message : 'connection failed') +
        '\nMake sure XRDP and guacd are running on the server.');
    };

    // First sync = first frame boundary; proves graphics are flowing.
    client.onsync = function () {
      if (!gotFrame) {
        gotFrame = true;
        log('first frame received');
        hideOverlay();
        fit();
      }
    };

    client.connect('token=' + encodeURIComponent(token));

    // Mouse
    const mouse = new Guacamole.Mouse(display.getElement());
    mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = function (state) {
      client.sendMouseState(state);
    };

    // Keyboard (captured on the whole document while this tab is focused)
    keyboard = new Guacamole.Keyboard(document);
    keyboard.onkeydown = function (keysym) { client.sendKeyEvent(1, keysym); };
    keyboard.onkeyup = function (keysym) { client.sendKeyEvent(0, keysym); };

    window.addEventListener('resize', fit);
  }

  // Scale the remote display to fit the container (never upscale past 1:1).
  function fit() {
    if (!display) return;
    const w = display.getWidth();
    const h = display.getHeight();
    if (!w || !h) return;
    const rect = displayEl.getBoundingClientRect();
    const scale = Math.min(rect.width / w, rect.height / h, 1);
    display.scale(scale);
  }

  function disconnect() {
    clearTimeout(watchdog);
    window.removeEventListener('resize', fit);
    if (keyboard) { keyboard.onkeydown = keyboard.onkeyup = null; keyboard = null; }
    if (client) { try { client.disconnect(); } catch (e) {} client = null; }
  }

  document.getElementById('btn-reconnect').addEventListener('click', function () {
    disconnect();
    gotFrame = false;
    connect();
  });
  // 'pagehide' replaces the deprecated 'unload' event.
  window.addEventListener('pagehide', disconnect);

  connect();
})();

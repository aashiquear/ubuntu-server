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

  let client = null;
  let keyboard = null;

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

    let token;
    try {
      const res = await fetch(
        '/api/desktop/token?width=' + width + '&height=' + height + '&dpi=' + dpi,
        { credentials: 'same-origin' }
      );
      if (res.status === 401) { location.href = '/login'; return; }
      token = (await res.json()).token;
    } catch (e) {
      setStatus('closed', 'Token error');
      showOverlay('Could not obtain a desktop session token.');
      return;
    }

    const tunnel = new Guacamole.WebSocketTunnel('/ws/guac');
    client = new Guacamole.Client(tunnel);

    // Reset display container and mount the canvas.
    displayEl.innerHTML = '';
    displayEl.appendChild(client.getDisplay().getElement());

    client.onstatechange = function (state) {
      // 0:idle 1:connecting 2:waiting 3:connected 4:disconnecting 5:disconnected
      if (state === 3) {
        setStatus('connected', 'Connected');
        hideOverlay();
      } else if (state === 1 || state === 2) {
        setStatus('', 'Connecting…');
      } else if (state === 5) {
        setStatus('closed', 'Disconnected');
        showOverlay('The remote desktop session has ended.');
      }
    };

    client.onerror = function (err) {
      setStatus('closed', 'Error');
      showOverlay('Remote desktop error: ' + (err && err.message ? err.message : 'connection failed') +
        '\nMake sure XRDP and guacd are running on the server.');
    };

    client.connect('token=' + encodeURIComponent(token) +
      '&width=' + width + '&height=' + height + '&dpi=' + dpi);

    // Mouse
    const display = client.getDisplay();
    const mouse = new Guacamole.Mouse(display.getElement());
    mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = function (state) {
      client.sendMouseState(state);
    };

    // Keyboard (captured on the whole document while this tab is focused)
    keyboard = new Guacamole.Keyboard(document);
    keyboard.onkeydown = function (keysym) { client.sendKeyEvent(1, keysym); };
    keyboard.onkeyup = function (keysym) { client.sendKeyEvent(0, keysym); };
  }

  function disconnect() {
    if (keyboard) { keyboard.onkeydown = keyboard.onkeyup = null; keyboard = null; }
    if (client) { try { client.disconnect(); } catch (e) {} client = null; }
  }

  document.getElementById('btn-reconnect').addEventListener('click', function () {
    disconnect();
    connect();
  });
  window.addEventListener('unload', disconnect);

  connect();
})();

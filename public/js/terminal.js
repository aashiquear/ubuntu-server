(function () {
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  function setStatus(cls, text) {
    statusEl.className = 'status ' + cls;
    statusText.textContent = text;
  }

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Ubuntu Mono", monospace',
    fontSize: 14,
    theme: { background: '#000000', foreground: '#e6edf6' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('term'));
  fit.fit();
  term.focus();

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/ws/terminal');

  function sendResize() {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  ws.onopen = function () {
    setStatus('connected', 'Connected');
    sendResize();
  };

  ws.onmessage = function (ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type === 'data') {
      term.write(msg.data);
    } else if (msg.type === 'exit') {
      term.write('\r\n\x1b[33m[process exited with code ' + msg.code + ']\x1b[0m\r\n');
    }
  };

  ws.onclose = function () { setStatus('closed', 'Disconnected'); };
  ws.onerror = function () { setStatus('closed', 'Connection error'); };

  term.onData(function (data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: data }));
    }
  });

  window.addEventListener('resize', function () {
    fit.fit();
    sendResize();
  });
})();

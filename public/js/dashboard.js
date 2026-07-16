(async function () {
  function pad(n) { return String(n).padStart(2, '0'); }

  function renderClock(elTime, elDate, date) {
    elTime.textContent = pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
    elDate.textContent = date.toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  let me = null;
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/login'; return; }
    me = await res.json();
  } catch (e) {
    console.error('Failed to load session', e);
    return;
  }

  document.getElementById('whoami').textContent = me.username + '@' + me.hostname;
  document.getElementById('host').textContent = me.hostname;
  document.getElementById('welcome').textContent = 'Welcome, ' + me.displayName + ' 👋';
  document.getElementById('welcome-sub').innerHTML =
    'You are signed in to <strong>' + me.hostname + '</strong> as <strong>' + me.username +
    '</strong>. Each feature below opens in its own tab and runs on the server.';

  // Browser timezone label
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  document.getElementById('browser-tz').textContent = browserTz;
  document.getElementById('server-tz').textContent = me.serverTimezone || 'server';

  // Offset between server clock and this browser, measured once at load so
  // the server clock keeps accurate time without polling every second.
  const serverOffset = me.serverTime - Date.now();

  const els = {
    st: document.getElementById('server-time'),
    sd: document.getElementById('server-date'),
    bt: document.getElementById('browser-time'),
    bd: document.getElementById('browser-date'),
  };

  function tick() {
    const now = Date.now();
    renderClock(els.bt, els.bd, new Date(now));
    renderClock(els.st, els.sd, new Date(now + serverOffset));
  }
  tick();
  setInterval(tick, 1000);
})();

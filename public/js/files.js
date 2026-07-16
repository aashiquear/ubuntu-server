(function () {
  let cwd = '.';

  const rowsEl = document.getElementById('rows');
  const crumbsEl = document.getElementById('crumbs');
  const dropzone = document.getElementById('dropzone');
  const uploadsEl = document.getElementById('uploads');

  function fmtSize(bytes) {
    if (!bytes) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
  }
  function fmtDate(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString();
  }
  function joinPath(a, b) {
    if (a === '.' || a === '') return b;
    return a + '/' + b;
  }
  function parentOf(p) {
    if (p === '.' || p === '') return '.';
    const parts = p.split('/');
    parts.pop();
    return parts.length ? parts.join('/') : '.';
  }

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts));
    if (res.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
    return res;
  }

  function renderCrumbs() {
    if (cwd === '.') { crumbsEl.innerHTML = '<strong>~</strong>'; return; }
    const parts = cwd.split('/');
    let acc = '.';
    const links = ['<a data-path=".">~</a>'];
    for (const p of parts) {
      acc = joinPath(acc, p);
      links.push('<a data-path="' + encodeURIComponent(acc) + '">' + escapeHtml(p) + '</a>');
    }
    crumbsEl.innerHTML = links.join(' / ');
    crumbsEl.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => load(decodeURIComponent(a.dataset.path)));
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function load(path) {
    const res = await api('/api/files/list?path=' + encodeURIComponent(path));
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed to list'); return; }
    cwd = data.cwd;
    renderCrumbs();
    render(data.items);
  }

  function render(items) {
    rowsEl.innerHTML = '';
    if (cwd !== '.') {
      const tr = document.createElement('tr');
      tr.className = 'row';
      tr.innerHTML = '<td class="name"><span class="ic">📂</span>..</td><td></td><td></td><td></td>';
      tr.querySelector('.name').onclick = () => load(parentOf(cwd));
      rowsEl.appendChild(tr);
    }
    for (const it of items) {
      const tr = document.createElement('tr');
      tr.className = 'row';
      const full = joinPath(cwd, it.name);
      const nameTd = document.createElement('td');
      nameTd.className = 'name';
      nameTd.innerHTML = '<span class="ic">' + (it.isDir ? '📁' : '📄') + '</span>' + escapeHtml(it.name);
      nameTd.onclick = () => {
        if (it.isDir) load(full);
        else download(full);
      };
      const sizeTd = document.createElement('td');
      sizeTd.textContent = it.isDir ? '—' : fmtSize(it.size);
      const mTd = document.createElement('td');
      mTd.className = 'muted';
      mTd.textContent = fmtDate(it.mtime);
      const actTd = document.createElement('td');
      actTd.className = 'actions';
      if (!it.isDir) {
        const dl = document.createElement('button');
        dl.className = 'link-btn';
        dl.textContent = 'download';
        dl.onclick = (e) => { e.stopPropagation(); download(full); };
        actTd.appendChild(dl);
      }
      const del = document.createElement('button');
      del.className = 'link-btn danger';
      del.textContent = 'delete';
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('Delete "' + it.name + '"?')) return;
        const r = await api('/api/files/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: full }),
        });
        if (!r.ok) { const d = await r.json(); alert(d.error || 'Delete failed'); return; }
        load(cwd);
      };
      actTd.appendChild(del);
      tr.append(nameTd, sizeTd, mTd, actTd);
      rowsEl.appendChild(tr);
    }
  }

  function download(full) {
    window.location = '/api/files/download?path=' + encodeURIComponent(full);
  }

  function uploadFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);

    const item = document.createElement('div');
    item.className = 'up-item';
    item.innerHTML = '<span>Uploading ' + files.length + ' item(s)…</span><div class="up-bar"><span></span></div>';
    uploadsEl.prepend(item);
    const bar = item.querySelector('.up-bar > span');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload?path=' + encodeURIComponent(cwd));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) bar.style.width = (e.loaded / e.total * 100).toFixed(1) + '%';
    };
    xhr.onload = () => {
      if (xhr.status === 401) { location.href = '/login'; return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        item.querySelector('span').textContent = 'Uploaded ' + files.length + ' item(s) ✓';
        bar.style.width = '100%';
        setTimeout(() => item.remove(), 2500);
        load(cwd);
      } else {
        item.querySelector('span').textContent = 'Upload failed';
      }
    };
    xhr.onerror = () => { item.querySelector('span').textContent = 'Upload error'; };
    xhr.send(form);
  }

  // Drag and drop
  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); if (ev !== 'dragover') dropzone.classList.remove('drag'); })
  );
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  document.getElementById('file-input').addEventListener('change', (e) => {
    uploadFiles(e.target.files);
    e.target.value = '';
  });
  document.getElementById('btn-refresh').onclick = () => load(cwd);
  document.getElementById('btn-mkdir').onclick = async () => {
    const name = prompt('New folder name:');
    if (!name) return;
    const r = await api('/api/files/mkdir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: cwd, name }),
    });
    if (!r.ok) { const d = await r.json(); alert(d.error || 'Failed'); return; }
    load(cwd);
  };

  // Init
  fetch('/api/me', { credentials: 'same-origin' })
    .then((r) => (r.status === 401 ? (location.href = '/login') : r.json()))
    .then((me) => { if (me) document.getElementById('whoami').textContent = me.username + '@' + me.hostname; });
  load('.');
})();

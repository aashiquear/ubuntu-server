'use strict';

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const multer = require('multer');

const router = express.Router();

/**
 * Resolve a client-supplied relative path against the authenticated
 * user's home directory and guarantee it never escapes that jail.
 * Returns the absolute path, or throws on traversal attempts.
 */
function resolveInHome(user, rel) {
  const home = path.resolve(user.home);
  const target = path.resolve(home, '.' + path.sep + (rel || '.'));
  if (target !== home && !target.startsWith(home + path.sep)) {
    const err = new Error('Path is outside of your home directory');
    err.status = 403;
    throw err;
  }
  return target;
}

function chownRecursiveSync(p, uid, gid) {
  try {
    fs.chownSync(p, uid, gid);
  } catch (_) {
    /* best effort */
  }
}

// Uploads are streamed straight into the requested directory (jailed to
// the user's home), then chowned to that user so ownership is correct.
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      try {
        const dir = resolveInHome(req.session.user, req.query.path || '.');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename(req, file, cb) {
      // Keep the original name; strip any directory components a browser
      // might send (webkitRelativePath etc.).
      cb(null, path.basename(file.originalname));
    },
  }),
  limits: { fileSize: parseInt(process.env.MAX_UPLOAD_BYTES || String(5 * 1024 * 1024 * 1024), 10) },
});

router.get('/list', async (req, res) => {
  try {
    const user = req.session.user;
    const dir = resolveInHome(user, req.query.path || '.');
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (ent) => {
        const full = path.join(dir, ent.name);
        let stat = null;
        try {
          stat = await fsp.stat(full);
        } catch (_) {
          /* broken symlink, permission, etc. */
        }
        return {
          name: ent.name,
          isDir: ent.isDirectory() || (stat && stat.isDirectory()),
          size: stat ? stat.size : 0,
          mtime: stat ? stat.mtimeMs : 0,
        };
      })
    );
    items.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
    );
    const rel = path.relative(path.resolve(user.home), dir);
    res.json({ cwd: rel === '' ? '.' : rel, home: user.home, items });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/download', async (req, res) => {
  try {
    const user = req.session.user;
    const target = resolveInHome(user, req.query.path);
    const stat = await fsp.stat(target);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Cannot download a directory' });
    }
    res.download(target, path.basename(target));
  } catch (err) {
    res.status(err.status || 404).json({ error: err.message });
  }
});

router.post('/upload', upload.array('files'), (req, res) => {
  const user = req.session.user;
  for (const f of req.files || []) {
    chownRecursiveSync(f.path, user.uid, user.gid);
  }
  res.json({ ok: true, uploaded: (req.files || []).map((f) => f.filename) });
});

router.post('/mkdir', express.json(), async (req, res) => {
  try {
    const user = req.session.user;
    const target = resolveInHome(user, path.join(req.body.path || '.', req.body.name || ''));
    await fsp.mkdir(target, { recursive: true });
    chownRecursiveSync(target, user.uid, user.gid);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/delete', express.json(), async (req, res) => {
  try {
    const user = req.session.user;
    const target = resolveInHome(user, req.body.path);
    if (path.resolve(target) === path.resolve(user.home)) {
      return res.status(403).json({ error: 'Refusing to delete home directory' });
    }
    await fsp.rm(target, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/rename', express.json(), async (req, res) => {
  try {
    const user = req.session.user;
    const from = resolveInHome(user, req.body.from);
    const to = resolveInHome(user, req.body.to);
    await fsp.rename(from, to);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.resolveInHome = resolveInHome;

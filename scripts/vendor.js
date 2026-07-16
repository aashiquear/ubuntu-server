#!/usr/bin/env node
/*
 * Copies browser-side vendor bundles out of node_modules into
 * public/vendor so the front-end can load them with plain <script>/<link>
 * tags. This keeps the dashboard fully self-hosted (no CDN), which matters
 * for an air-gapped LAN server.
 *
 * Runs automatically on `npm install` (postinstall). Individual failures
 * are non-fatal so `npm install` still succeeds; the affected feature just
 * won't load until its bundle is available.
 */
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'public', 'vendor');
fs.mkdirSync(outDir, { recursive: true });

function pkgDir(name) {
  // Direct resolution works for packages that expose ./package.json.
  try {
    return path.dirname(require.resolve(name + '/package.json'));
  } catch (_) {
    /* package uses an `exports` map that blocks package.json — fall through */
  }
  // Fall back: resolve the package entry and walk up to its own package.json.
  let entry;
  try {
    entry = require.resolve(name);
  } catch (_) {
    return null;
  }
  let dir = path.dirname(entry);
  for (let i = 0; i < 12; i++) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj)) {
      try {
        if (JSON.parse(fs.readFileSync(pj, 'utf8')).name === name) return dir;
      } catch (_) {
        /* keep walking */
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// Copy the first candidate that exists; optionally fall back to a recursive
// search for a file matching `pattern`.
function copyFrom(pkg, candidates, destName, pattern) {
  const dir = pkgDir(pkg);
  if (!dir) {
    console.warn(`[vendor] package '${pkg}' not found; skipping ${destName}`);
    return;
  }
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) {
      fs.copyFileSync(p, path.join(outDir, destName));
      console.log(`[vendor] ${pkg}/${c} -> vendor/${destName}`);
      return;
    }
  }
  if (pattern) {
    const found = search(dir, pattern);
    if (found) {
      fs.copyFileSync(found, path.join(outDir, destName));
      console.log(`[vendor] ${path.relative(dir, found)} -> vendor/${destName}`);
      return;
    }
  }
  console.warn(`[vendor] no bundle found in '${pkg}' for ${destName}`);
}

function search(root, pattern) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory() && ent.name !== 'node_modules') stack.push(full);
      else if (ent.isFile() && pattern.test(ent.name)) return full;
    }
  }
  return null;
}

// xterm.js terminal
copyFrom('xterm', ['lib/xterm.js', 'dist/xterm.js'], 'xterm.js', /^xterm\.js$/);
copyFrom('xterm', ['css/xterm.css', 'dist/xterm.css'], 'xterm.css', /^xterm\.css$/);
copyFrom(
  'xterm-addon-fit',
  ['lib/xterm-addon-fit.js', 'dist/xterm-addon-fit.js'],
  'xterm-addon-fit.js',
  /^xterm-addon-fit\.js$/
);

// Guacamole browser client (RDP desktop). The published bundle is a CommonJS
// concatenation ending in `module.exports = Guacamole;`. Loaded via a plain
// <script> tag, the top-level `var Guacamole` already becomes a browser global,
// but that trailing line throws (no `module`). Rewrite it to an explicit global
// assignment so the file is a clean browser script.
copyFrom(
  'guacamole-common-js',
  [
    'dist/cjs/guacamole-common.min.js',
    'dist/cjs/guacamole-common.js',
    'dist/guacamole-common.min.js',
    'dist/guacamole-common.js',
  ],
  'guacamole-common.min.js',
  /guacamole-common(\.min)?\.js$/
);
patchGlobal(path.join(outDir, 'guacamole-common.min.js'));

function patchGlobal(file) {
  if (!fs.existsSync(file)) return;
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes('module.exports')) {
    src = src.replace(/module\.exports\s*=\s*Guacamole\s*;?/, 'window.Guacamole=Guacamole;');
    fs.writeFileSync(file, src);
    console.log('[vendor] patched guacamole-common.min.js -> browser global');
  }
}

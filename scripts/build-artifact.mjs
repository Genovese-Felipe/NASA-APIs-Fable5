#!/usr/bin/env node
/* ── Cosmoscope build ───────────────────────────────────────────────
   Inlines the modular sources into two self-contained files:
     dist/cosmoscope-standalone.html — full document; works from
       file:// (double-click) or any static host
     dist/artifact.html — body fragment (title/style/markup/script)
       for publishing as a Claude Artifact, whose pipeline wraps it
       in its own <!doctype>/<head>/<body> skeleton
   ES modules are concatenated in dependency order with import lines
   stripped and `export ` prefixes removed — all top-level names are
   globally unique across modules by convention (enforced here).    */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/* dependency order (imports only ever point earlier in this list) */
const JS_ORDER = [
  'js/i18n.js',
  'js/orbits.js',
  'js/engine.js',
  'js/audio.js',
  'js/nasa.js',
  'js/capture.js',
  'js/ui.js',
  'js/main.js',
];

function stripModule(src, file) {
  const out = [];
  for (const line of src.split('\n')) {
    if (/^import\s/.test(line)) {
      if (!/from\s+'\.\/[a-z0-9]+\.js';?\s*$/.test(line)) {
        throw new Error(`${file}: only single-line relative imports are supported: ${line}`);
      }
      continue;
    }
    out.push(line.replace(/^export\s+(?=(?:async\s+)?(?:const|let|function|class)\b)/, ''));
  }
  const joined = out.join('\n');
  if (/^export\s/m.test(joined)) {
    throw new Error(`${file}: unhandled export form remains after stripping`);
  }
  return joined;
}

/* duplicate top-level identifier guard */
function topLevelNames(src) {
  const names = [];
  for (const m of src.matchAll(/^(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1]);
  return names;
}

const seen = new Map();
const chunks = [];
for (const f of JS_ORDER) {
  const stripped = stripModule(read(f), f);
  for (const n of topLevelNames(stripped)) {
    if (seen.has(n)) throw new Error(`duplicate top-level name "${n}" in ${f} (first in ${seen.get(n)})`);
    seen.set(n, f);
  }
  chunks.push(`/* ══════ ${f} ══════ */\n${stripped}`);
}
const bundle = `(function () {\n'use strict';\n${chunks.join('\n\n')}\n})();`;
if (bundle.includes('</script')) throw new Error('bundle contains </script — would break inline embedding');

const css = read('css/app.css');
const icon = read('assets/icon.svg');
const iconUri = 'data:image/svg+xml,' + encodeURIComponent(icon.replace(/\n\s*/g, ' ').trim());

let html = read('index.html');
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${iconUri}">`);
html = html.replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`);
const SCRIPT_TAG = '<script type="module" src="js/main.js"></script>';
if (!html.includes(SCRIPT_TAG)) throw new Error('module script tag not found in index.html');
const shell = html.replace(SCRIPT_TAG, '');
if (/js\/main\.js|css\/app\.css|manifest\.webmanifest/.test(shell)) {
  throw new Error('standalone build still references external project files');
}
html = html.replace(SCRIPT_TAG, () => `<script>\n${bundle}\n</script>`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/cosmoscope-standalone.html'), html);

/* artifact fragment: title + style + body contents (no document shell) */
const title = html.match(/<title>([^<]*)<\/title>/)[1];
const bodyInner = html.match(/<body>\n?([\s\S]*)<\/body>/)[1];
const fragment = `<title>${title}</title>\n<style>\n${css}\n</style>\n${bodyInner}`;
writeFileSync(join(root, 'dist/artifact.html'), fragment);

const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(1) + ' KB';
console.log(`dist/cosmoscope-standalone.html  ${kb(html)}`);
console.log(`dist/artifact.html               ${kb(fragment)}`);

/**
 * Builds dist/exar1view.html: index.html with the CSS, sql.js (script + WASM as
 * base64) and the bundled app inlined, plus a hash-based CSP. Needs network
 * for `npx esbuild`. Run from the repo root: node scripts/build-single.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Newest esbuild release published at least two weeks before 2026-10-23
// (0.28.2, 2026-08-08).
const ESBUILD_VERSION = '0.28.2';
const OUT = 'dist/exar1view.html';

const read = (/** @type {string} */ p) => readFileSync(p);
const sha256 = (/** @type {string | Uint8Array} */ x, enc = /** @type {'hex' | 'base64'} */ ('base64')) =>
  createHash('sha256').update(x).digest(enc);

/** @param {string} what @param {string} text */
function assertInlineSafe(what, text) {
  const bad = /<\/script|<\/style|<!--/i.exec(text);
  if (bad) throw new Error(`${what} contains "${bad[0]}", which would break out of its inline tag`);
  // Browsers hash the parsed text (CRLF/CR become LF, NUL becomes U+FFFD), so the raw text must not differ.
  if (/[\r\0]/.test(text)) throw new Error(`${what} contains a CR or NUL character, which would change its CSP hash after parsing`);
}

/** Replace `marker` plus the single tag matching `tag` that follows it. */
function replaceMarked(/** @type {string} */ html, /** @type {string} */ marker, /** @type {RegExp} */ tag, /** @type {string} */ replacement) {
  const token = `<!-- ${marker} -->`;
  if (html.split(token).length !== 2) throw new Error(`index.html must contain ${token} exactly once`);
  const re = new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*${tag.source}`);
  if (!re.test(html)) throw new Error(`${token} is not followed by the expected tag ${tag}`);
  return html.replace(re, () => replacement);
}

const css = read('app.css').toString('utf8');
const sqlJs = read('vendor/sql.js/sql-wasm.js').toString('utf8');
const wasmBase64 = read('vendor/sql.js/sql-wasm.wasm').toString('base64');
const app = execFileSync(
  'npx',
  ['-y', `esbuild@${ESBUILD_VERSION}`, 'src/main.js', '--bundle', '--format=iife',
    '--target=chrome103,firefox113,safari16.4', '--charset=utf8'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
);

assertInlineSafe('app.css', css);
assertInlineSafe('sql-wasm.js', sqlJs);
assertInlineSafe('app bundle', app);

let html = read('index.html').toString('utf8');
html = replaceMarked(html, 'build:css', /<link rel="stylesheet" href="app\.css">/, `<style>${css}</style>`);
html = replaceMarked(
  html, 'build:sqljs', /<script src="vendor\/sql\.js\/sql-wasm\.js"><\/script>/,
  `<script>${sqlJs}</script>\n  <script type="application/octet-stream" id="sqljs-wasm">${wasmBase64}</script>`,
);
html = replaceMarked(html, 'build:app', /<script type="module" src="src\/main\.js"><\/script>/, `<script>${app}</script>`);

const csp = [
  "default-src 'none'",
  `script-src 'sha256-${sha256(sqlJs)}' 'sha256-${sha256(app)}' 'wasm-unsafe-eval'`,
  `style-src 'sha256-${sha256(css)}'`,
  'img-src data:',
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// Swap the dev CSP (and its comment) for the hash-based one, then add the build id.
const devCsp = /[ \t]*<!--[^>]*-->\s*<meta http-equiv="Content-Security-Policy"[^>]*>\n/g;
if ((html.match(devCsp) ?? []).length !== 1) throw new Error('index.html must contain exactly one dev CSP meta');
/** @param {string[]} args @param {string} fallback */
const git = (args, fallback) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
};
// The HEAD commit time (not now) keeps rebuilds of one commit byte-identical.
const describe = git(['describe', '--always', '--dirty'], 'unknown');
const commitTime = git(['log', '-1', '--format=%cI'], 'none');
const buildMeta = `<meta name="exar1view-build" content="${describe} ${commitTime}">`;
html = html.replace(devCsp, () => `  <meta http-equiv="Content-Security-Policy" content="${csp}">\n  ${buildMeta}\n`);

mkdirSync('dist', { recursive: true });
writeFileSync(OUT, html);
console.log(`${OUT}: ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB, sha256 ${sha256(html, 'hex')}`);

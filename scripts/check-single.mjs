/**
 * Sanity checks for the single-file build. Usage: node scripts/check-single.mjs dist/exarview.html
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MAX_BYTES = 3 * 1024 * 1024;
const file = process.argv[2];
if (!file) throw new Error('usage: check-single.mjs <file>');

const html = readFileSync(file, 'utf8');
const sha256 = (/** @type {string | Uint8Array} */ x, enc = /** @type {'hex' | 'base64'} */ ('base64')) =>
  createHash('sha256').update(x).digest(enc);
/** @type {string[]} */
const failures = [];
const check = (/** @type {boolean} */ ok, /** @type {string} */ msg) => { if (!ok) failures.push(msg); };

// Inline elements by tag, found through the raw text (contents never contain a closing tag; the build asserts it).
const blocks = (/** @type {string} */ tag) =>
  [...html.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))]
    .map((m) => ({ attrs: m[1] ?? '', text: m[2] }));
const scripts = blocks('script');
const styles = blocks('style');
const stripped = html.replace(/<(script|style)(\s[^>]*)?>[\s\S]*?<\/\1>/g, '$1');

check(!/\s(src|href)\s*=/i.test(stripped), 'markup has src= or href= attributes');
check(!/\s(src|href)\s*=/i.test(scripts.map((s) => s.attrs).join(' ')), 'a script tag has src=');
check(!/<link\b/i.test(stripped), 'markup has a <link> element');
check(!/\s(srcset|poster|action|data)\s*=/i.test(stripped), 'markup has a srcset=, poster=, action= or data= attribute');
check(!/http-equiv\s*=\s*["']?refresh/i.test(stripped), 'markup has a refresh meta');
// Browsers hash the parsed text (CR -> LF, NUL -> U+FFFD), so raw CR/NUL would break the hashes.
check(![...scripts, ...styles].some((b) => /[\r\0]/.test(b.text)), 'an inline script or style contains CR or NUL');

const wasm = scripts.find((s) => /\bid="sqljs-wasm"/.test(s.attrs));
check(Boolean(wasm), '#sqljs-wasm block missing');
if (wasm) {
  const version = readFileSync(new URL('../vendor/sql.js/VERSION', import.meta.url), 'utf8');
  const expected = /^sha256 sql-wasm\.wasm: ([0-9a-f]{64})$/m.exec(version)?.[1];
  check(Boolean(expected), 'VERSION has no wasm sha256');
  check(sha256(Buffer.from(wasm.text.trim(), 'base64'), 'hex') === expected, 'embedded wasm does not match VERSION sha256');
}

const csps = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)">/g)].map((m) => m[1]);
check(csps.length === 1 && (html.match(/Content-Security-Policy/g) ?? []).length === 1, `expected exactly one CSP meta, found ${csps.length}`);
if (csps.length === 1) {
  const policy = csps[0];
  const sources = (/** @type {string} */ name) => {
    const d = policy.split(';').map((x) => x.trim().split(/\s+/)).find((x) => x[0] === name);
    return d ? d.slice(1) : undefined;
  };
  const hashes = (/** @type {string} */ name) => (sources(name) ?? []).filter((x) => x.startsWith("'sha256-")).map((x) => x.slice(8, -1));
  check(sources('default-src')?.join(' ') === "'none'", "default-src is not 'none'");
  check(sources('connect-src')?.join(' ') === "'none'", "connect-src is not 'none'");
  check((sources('script-src') ?? ["'x'"]).every((x) => /^'sha256-[A-Za-z0-9+/]+=*'$/.test(x) || x === "'wasm-unsafe-eval'"),
    "script-src has sources other than sha256 hashes and 'wasm-unsafe-eval'");
  check((sources('style-src') ?? ["'x'"]).every((x) => /^'sha256-[A-Za-z0-9+/]+=*'$/.test(x)),
    'style-src has sources other than sha256 hashes');
  check(!/(^|\s)\*|'self'|'unsafe-eval'|'unsafe-inline'|\b[a-z][a-z0-9+.-]*:(\s|;|$)|https?:/i.test(policy.replace(/'sha256-[^']*'/g, '').replace(/img-src data:/, '')),
    "CSP has a wildcard, scheme source, 'self', 'unsafe-eval' or 'unsafe-inline'");
  const executing = scripts.filter((s) => !/type="application\/octet-stream"/.test(s.attrs));
  const want = (/** @type {{text: string}[]} */ list) => list.map((b) => sha256(b.text)).sort().join(',');
  check(hashes('script-src').slice().sort().join(',') === want(executing), 'script-src hashes do not match the inline scripts');
  check(hashes('style-src').slice().sort().join(',') === want(styles), 'style-src hashes do not match the inline styles');
  const cspAt = html.indexOf('http-equiv="Content-Security-Policy"');
  const firstAt = Math.min(...['<script', '<style', '<link'].map((t) => { const i = html.indexOf(t); return i < 0 ? Infinity : i; }));
  check(cspAt >= 0 && cspAt < firstAt, 'CSP meta must come before the first <script, <style or <link');
}

const size = Buffer.byteLength(html);
check(size < MAX_BYTES, `size ${size} is not under ${MAX_BYTES}`);

if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}
console.log(`${file}: ok (${(size / 1048576).toFixed(2)} MB)`);

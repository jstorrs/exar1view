import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Each vendored dir records the sha256 of its files in VERSION. */
const vendored = {
  'sql.js': ['sql-wasm.js', 'sql-wasm.wasm'],
  fflate: ['browser.js', 'browser.d.ts'],
};

for (const [pkg, names] of Object.entries(vendored)) {
  const dir = new URL(`../vendor/${pkg}/`, import.meta.url);
  const version = readFileSync(new URL('VERSION', dir), 'utf8');
  for (const name of names) {
    test(`vendored ${pkg}/${name} matches the sha256 in VERSION`, () => {
      const actual = createHash('sha256').update(readFileSync(new URL(name, dir))).digest('hex');
      const m = version.match(new RegExp(`^sha256 ${name.replaceAll('.', '\\.')}: ([0-9a-f]{64})$`, 'm'));
      assert.ok(m, `no checksum for ${name} in VERSION`);
      assert.equal(actual, m[1]);
    });
  }
}

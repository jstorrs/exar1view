import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const dir = new URL('../vendor/sql.js/', import.meta.url);
const version = readFileSync(new URL('VERSION', dir), 'utf8');

for (const name of ['sql-wasm.js', 'sql-wasm.wasm']) {
  test(`vendored ${name} matches the sha256 in VERSION`, () => {
    const actual = createHash('sha256').update(readFileSync(new URL(name, dir))).digest('hex');
    const m = version.match(new RegExp(`^sha256 ${name.replace('.', '\\.')}: ([0-9a-f]{64})$`, 'm'));
    assert.ok(m, `no checksum for ${name} in VERSION`);
    assert.equal(actual, m[1]);
  });
}

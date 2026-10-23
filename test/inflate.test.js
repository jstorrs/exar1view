import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { inflateRaw } from '../src/platform/inflate.js';

test('inflateRaw round-trips raw deflate data', async () => {
  const text = '<doc>' + 'exar1 '.repeat(5000) + '</doc>';
  const out = await inflateRaw(new Uint8Array(deflateRawSync(Buffer.from(text))));
  assert.equal(new TextDecoder().decode(out), text);
});

test('inflateRaw handles empty content', async () => {
  const out = await inflateRaw(new Uint8Array(deflateRawSync(Buffer.alloc(0))));
  assert.equal(out.length, 0);
});

test('inflateRaw rejects corrupt input with a clear message', async () => {
  await assert.rejects(
    inflateRaw(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x01, 0x02])),
    /^Error: Content is not valid raw DEFLATE: /,
  );
});

test('inflateRaw rejects zero-length input', async () => {
  await assert.rejects(inflateRaw(new Uint8Array(0)), /zero-length/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/platform/sqlite.js';
import { inflateRaw } from '../src/platform/inflate.js';
import { createFileSource } from '../src/platform/source.js';
import { loadExar } from '../src/core/load.js';
import { protocolBlobs, scanProtocols } from '../src/core/seqscan.js';
import { loadSql } from './sqljs.js';
import { buildExar } from './fixture/builder.js';

const FIXTURE = buildExar();

/** A file with one program whose measurement steps use `blobs` (null = no protocol). */
const fileWith = (id, blobs) => ({
  id,
  regions: [{ exams: [{ programs: [{ body: blobs.map((b, i) => ({ type: 'step', step: { kind: 'Measurement', key: `s${i}`, detail: { protocolBlob: b } } })) }] }] }],
});

/** A readText over fixed texts that counts reads; unknown blobs fail. */
function fakeReader(texts) {
  const reads = [];
  const readText = async (fileId, blob) => {
    reads.push(`${fileId}:${blob}`);
    return blob in texts ? { ok: true, text: texts[blob] } : { ok: false, error: 'protocol content is missing' };
  };
  return { reads, readText };
}

const seq = (name) => `tSequenceFileName = "%CustomerSeq%\\${name}"`;
const never = new AbortController().signal;
const noYield = async () => {};

test('protocolBlobs lists the distinct blobs in tree order and skips steps without one', () => {
  assert.deepEqual(protocolBlobs(fileWith('f', ['b', null, 'a', 'b'])), ['b', 'a']);
});

test('progress rises to the total, yielding once per slice', async () => {
  const { reads, readText } = fakeReader({ a: seq('a'), b: seq('b'), c: seq('c') });
  const cache = new Map();
  let t = 0;
  let yields = 0;
  const progress = [];
  const result = await scanProtocols({
    files: [fileWith('f1', ['a', 'b']), fileWith('f2', ['c'])], cache, readText, signal: never,
    onProgress: (p) => progress.push(p.done), now: () => (t += 100), yieldNow: async () => { yields++; },
  });
  assert.equal(result, 'done');
  assert.equal(reads.length, 3);
  assert.equal(yields, 3);
  assert.deepEqual(progress.slice(0, 2), [0, 1]);
  assert.deepEqual(progress.at(-1), 3);
  assert.deepEqual(cache.get('f1').get('a'), { ok: true, refs: [{ key: 'tSequenceFileName', value: '%CustomerSeq%\\a', placeholder: 'CustomerSeq' }] });
});

test('no yield while the slice has time left', async () => {
  const { readText } = fakeReader({ a: '', b: '' });
  let yields = 0;
  await scanProtocols({
    files: [fileWith('f', ['a', 'b'])], cache: new Map(), readText, signal: never, onProgress() {}, now: () => 0, yieldNow: async () => { yields++; },
  });
  assert.equal(yields, 0);
});

test('totals report what is missing; cancelling keeps completed blobs and a rerun reads the rest', async () => {
  const { reads, readText } = fakeReader({ a: seq('a'), b: seq('b'), c: seq('c') });
  const cache = new Map();
  const files = [fileWith('f', ['a', 'b', 'c'])];
  const ctl = new AbortController();
  let t = 0;
  const totals = [];
  const first = await scanProtocols({
    files, cache, readText, signal: ctl.signal, now: () => (t += 100),
    onProgress: (p) => totals.push(p),
    yieldNow: async () => { if (cache.get('f').size === 2) ctl.abort(); },
  });
  assert.equal(first, 'cancelled');
  assert.deepEqual([...cache.get('f').keys()], ['a', 'b']);
  assert.deepEqual(totals.at(-1), { done: 2, total: 3 });
  reads.length = 0;
  const totals2 = [];
  assert.equal(await scanProtocols({ files, cache, readText, signal: never, onProgress: (p) => totals2.push(p), yieldNow: noYield }), 'done');
  assert.deepEqual(reads, ['f:c']);
  assert.deepEqual([totals2[0], totals2.at(-1)], [{ done: 0, total: 1 }, { done: 1, total: 1 }]);
});

test('an abort before the first read reads nothing', async () => {
  const { reads, readText } = fakeReader({ a: '' });
  const ctl = new AbortController();
  ctl.abort();
  assert.equal(await scanProtocols({ files: [fileWith('f', ['a'])], cache: new Map(), readText, signal: ctl.signal, onProgress() {} }), 'cancelled');
  assert.equal(reads.length, 0);
});

test('read errors are cached; a read resolving after an abort is not stored', async () => {
  const { readText } = fakeReader({ a: seq('a') });
  const cache = new Map();
  assert.equal(await scanProtocols({ files: [fileWith('f', ['a', 'gone'])], cache, readText, signal: never, onProgress() {}, yieldNow: noYield }), 'done');
  assert.deepEqual(cache.get('f').get('gone'), { ok: false, error: 'protocol content is missing' });

  const ctl = new AbortController();
  const late = async () => { ctl.abort(); return { ok: false, error: 'the file is closed' }; };
  const late2 = new Map();
  assert.equal(await scanProtocols({ files: [fileWith('f', ['a'])], cache: late2, readText: late, signal: ctl.signal, onProgress() {} }), 'cancelled');
  assert.equal(late2.size, 0);
});

test('a scan of the fixture finds the customer, service and standard references', async () => {
  const opened = openDb(await loadSql(), FIXTURE);
  const res = await loadExar(opened.db, inflateRaw, { id: 'f1', name: 'x.exar1', size: FIXTURE.length });
  assert.ok(res.ok);
  const source = createFileSource(opened, inflateRaw);
  const cache = new Map();
  const result = await scanProtocols({
    files: [res.file], cache, readText: (_, blob) => source.text(blob), signal: never, onProgress() {}, yieldNow: noYield,
  });
  assert.equal(result, 'done');
  const refsOf = (label) => {
    const steps = res.file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs.flatMap((p) => p.body)));
    const found = [];
    const walk = (nodes) => nodes.forEach((n) => (n.type === 'step' ? found.push(n.step) : (found.push(n.split, n.join), n.branches.forEach((b) => walk(b.body)))));
    walk(steps);
    const step = found.find((s) => s.label === label);
    const r = cache.get('f1').get(step.detail.protocolBlob);
    assert.ok(r.ok, r.ok ? '' : r.error);
    return r.refs.map((x) => `${x.key}=${x.value}`);
  };
  assert.deepEqual(refsOf('Sag T1 FS'), [
    'tSequenceFileName=%CustomerSeq%\\cust_tse_v2',
    'tdefaultEVAProt=%CustomerEvaDefProt%\\DTI\\DTI_990.evp',
  ]);
  assert.deepEqual(refsOf('T1 cor'), ['tSequenceFileName=%ServiceSeq%\\rf_noise_spectrum']);
  assert.deepEqual(refsOf('Survey'), ['tSequenceFileName=%SiemensSeq%\\gre']);
  assert.equal(protocolBlobs(res.file).length, cache.get('f1').size);
  source.close();
});

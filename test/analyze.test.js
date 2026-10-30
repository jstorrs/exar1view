import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/platform/sqlite.js';
import { inflateRaw } from '../src/platform/inflate.js';
import { createFileSource } from '../src/platform/source.js';
import { loadExar } from '../src/core/load.js';
import { addInBlobs, analyzeFile, emptyResults, missingCount, protocolBlobs } from '../src/core/analyze.js';
import { loadSql } from './sqljs.js';
import { buildExar } from './fixture/builder.js';

const FIXTURE = buildExar();

const MEAS = { Measurement: (p, a) => ({ protocolBlob: p, addInBlob: a }) };
/** A file with one program whose steps are `[kind, protocolBlob, addInBlob]` (null = none). */
const fileWith = (steps) => ({
  id: 'f',
  regions: [{ exams: [{ programs: [{ body: steps.map(([kind, p, a], i) => ({
    type: 'step', step: { kind, key: `s${i}`, detail: kind === 'Measurement' ? MEAS.Measurement(p, a) : { addInBlob: a } },
  })) }] }] }],
});
const meas = (p, a = null) => ['Measurement', p, a];

/** Readers over fixed texts and add-in names that count reads; unknown blobs fail. */
function fakeReaders(texts, addIns = {}, upgrades = {}) {
  const reads = [];
  const readText = async (blob) => {
    reads.push(`t:${blob}`);
    return blob in texts ? { ok: true, text: texts[blob], upgrade: upgrades[blob] ?? null } : { ok: false, error: 'protocol content is missing' };
  };
  const readAddIn = async (blob) => {
    reads.push(`a:${blob}`);
    return blob in addIns ? { ok: true, name: addIns[blob], raw: addIns[blob] } : { ok: false, error: 'add-in content is missing' };
  };
  return { reads, readText, readAddIn };
}

const seq = (name) => `tSequenceFileName = "%CustomerSeq%\\${name}"`;
const never = new AbortController().signal;
const noYield = async () => {};

test('protocolBlobs lists the distinct blobs in tree order and skips steps without one', () => {
  assert.deepEqual(protocolBlobs(fileWith([meas('b'), meas(null), meas('a'), ['Interaction', null, 'x'], meas('b')])), ['b', 'a']);
});

test('addInBlobs lists the distinct blobs in tree order across step kinds, skipping null and empty', () => {
  const file = fileWith([meas('p', 'b'), ['Interaction', null, null], ['Workflow', null, 'a'], ['Decision', null, ''], ['Interaction', null, 'b'], ['Pause', null, null], meas('q', 'c')]);
  assert.deepEqual(addInBlobs(file), ['b', 'a', 'c']);
});

test('missingCount counts protocols and add-ins not in the results', () => {
  const file = fileWith([meas('p1', 'a1'), meas('p2', 'a1'), ['Interaction', null, 'a2']]);
  const results = emptyResults();
  assert.equal(missingCount(file, results), 4);
  results.refs.set('p1', { ok: true, refs: [] });
  results.addIns.set('a1', { ok: false, error: 'x' });
  assert.equal(missingCount(file, results), 2);
});

test('progress counts both kinds and rises to the total, yielding once per slice', async () => {
  const { reads, readText, readAddIn } = fakeReaders({ p1: seq('a'), p2: seq('b') }, { a1: 'Dot' });
  const results = emptyResults();
  let t = 0;
  let yields = 0;
  const progress = [];
  const result = await analyzeFile({
    file: fileWith([meas('p1', 'a1'), meas('p2')]), results, readText, readAddIn, signal: never,
    onProgress: (p) => progress.push(p), now: () => (t += 100), yieldNow: async () => { yields++; },
  });
  assert.equal(result, 'done');
  assert.deepEqual(reads, ['t:p1', 't:p2', 'a:a1']);
  assert.equal(yields, 3);
  assert.deepEqual(progress[0], { done: 0, total: 3 });
  assert.deepEqual(progress.at(-1), { done: 3, total: 3 });
  assert.deepEqual(results.refs.get('p1'), { ok: true, refs: [{ key: 'tSequenceFileName', value: '%CustomerSeq%\\a', placeholder: 'CustomerSeq' }] });
  assert.deepEqual(results.addIns.get('a1'), { ok: true, name: 'Dot', raw: 'Dot' });
});

test('no yield while the slice has time left', async () => {
  const { readText, readAddIn } = fakeReaders({ p: '' }, { a: 'Dot' });
  let yields = 0;
  await analyzeFile({
    file: fileWith([meas('p', 'a')]), results: emptyResults(), readText, readAddIn, signal: never, onProgress() {}, now: () => 0, yieldNow: async () => { yields++; },
  });
  assert.equal(yields, 0);
});

test('cancelling keeps what was read and a rerun reads only the missing blobs of both kinds', async () => {
  const { reads, readText, readAddIn } = fakeReaders({ p1: seq('a'), p2: seq('b') }, { a1: 'Dot', a2: 'Dot' });
  const results = emptyResults();
  const file = fileWith([meas('p1', 'a1'), meas('p2', 'a2')]);
  const ctl = new AbortController();
  let t = 0;
  const totals = [];
  const first = await analyzeFile({
    file, results, readText, readAddIn, signal: ctl.signal, now: () => (t += 100),
    onProgress: (p) => totals.push(p),
    yieldNow: async () => { if (results.refs.size === 2 && results.addIns.size === 1) ctl.abort(); },
  });
  assert.equal(first, 'cancelled');
  assert.deepEqual([...results.refs.keys()], ['p1', 'p2']);
  assert.deepEqual([...results.addIns.keys()], ['a1']);
  assert.deepEqual(totals.at(-1), { done: 3, total: 4 });
  reads.length = 0;
  const totals2 = [];
  assert.equal(await analyzeFile({ file, results, readText, readAddIn, signal: never, onProgress: (p) => totals2.push(p), yieldNow: noYield }), 'done');
  assert.deepEqual(reads, ['a:a2']);
  assert.deepEqual([totals2[0], totals2.at(-1)], [{ done: 0, total: 1 }, { done: 1, total: 1 }]);
  assert.equal(missingCount(file, results), 0);
});

test('an abort before the first read reads nothing', async () => {
  const { reads, readText, readAddIn } = fakeReaders({ p: '' }, { a: 'Dot' });
  const ctl = new AbortController();
  ctl.abort();
  assert.equal(await analyzeFile({ file: fileWith([meas('p', 'a')]), results: emptyResults(), readText, readAddIn, signal: ctl.signal, onProgress() {} }), 'cancelled');
  assert.equal(reads.length, 0);
});

test('read errors are stored; a read resolving after an abort is not stored', async () => {
  const { readText, readAddIn } = fakeReaders({});
  const results = emptyResults();
  const file = fileWith([meas('gone', 'nope')]);
  assert.equal(await analyzeFile({ file, results, readText, readAddIn, signal: never, onProgress() {}, yieldNow: noYield }), 'done');
  assert.deepEqual(results.refs.get('gone'), { ok: false, error: 'protocol content is missing' });
  assert.deepEqual(results.addIns.get('nope'), { ok: false, error: 'add-in content is missing' });

  for (const file2 of [fileWith([meas('p')]), fileWith([['Interaction', null, 'a']])]) {
    const ctl = new AbortController();
    const lateText = async () => { ctl.abort(); return { ok: false, error: 'the file is closed' }; };
    const lateAddIn = async () => { ctl.abort(); return { ok: false, error: 'the file is closed' }; };
    const late = emptyResults();
    assert.equal(await analyzeFile({ file: file2, results: late, readText: lateText, readAddIn: lateAddIn, signal: ctl.signal, onProgress() {} }), 'cancelled');
    assert.equal(late.refs.size + late.addIns.size, 0);
  }
});

test('only protocols with upgrade notes are recorded, and not failed or late reads or on a resumed run', async () => {
  const { reads, readText, readAddIn } = fakeReaders({ p1: '', p2: '' }, {}, { p2: 'note' });
  const results = emptyResults();
  const file = fileWith([meas('p1'), meas('p2'), meas('gone')]);
  await analyzeFile({ file, results, readText, readAddIn, signal: never, onProgress() {}, yieldNow: noYield });
  assert.deepEqual([...results.upgrades], [['p2', 'note']]);
  reads.length = 0;
  await analyzeFile({ file, results, readText, readAddIn, signal: never, onProgress() {}, yieldNow: noYield });
  assert.deepEqual(reads, []);
  assert.deepEqual([...results.upgrades], [['p2', 'note']]);

  const ctl = new AbortController();
  const late = emptyResults();
  const lateText = async () => { ctl.abort(); return { ok: true, text: '', upgrade: 'note' }; };
  await analyzeFile({ file: fileWith([meas('p')]), results: late, readText: lateText, readAddIn, signal: ctl.signal, onProgress() {} });
  assert.equal(late.upgrades.size, 0);
});

test('an analysis of the fixture reads its add-ins and protocol references', async () => {
  const opened = openDb(await loadSql(), FIXTURE);
  const res = await loadExar(opened.db, inflateRaw, { id: 'f1', name: 'x.exar1', size: FIXTURE.length });
  assert.ok(res.ok);
  const source = createFileSource(opened, inflateRaw);
  const results = emptyResults();
  const result = await analyzeFile({
    file: res.file, results, readText: (b) => source.text(b), readAddIn: (b) => source.addIn(b), signal: never, onProgress() {}, yieldNow: noYield,
  });
  assert.equal(result, 'done');
  const found = [];
  const walk = (nodes) => nodes.forEach((n) => (n.type === 'step' ? found.push(n.step) : (found.push(n.split, n.join), n.branches.forEach((b) => walk(b.body)))));
  walk(res.file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs.flatMap((p) => p.body))));
  const step = (label) => found.find((s) => s.label === label);
  assert.deepEqual(results.addIns.get(step('Three-plane localizer').detail.addInBlob), {
    ok: true, name: 'AutoAlignScout', raw: 'i18n://syngo.MR.ExamAddIn.Configurations/Resource/AutoAlignScout',
  });
  assert.deepEqual(results.addIns.get(step('Confirm coil').detail.addInBlob), { ok: true, name: 'Dot', raw: 'Dot' });
  const refs = results.refs.get(step('Sag T1 FS').detail.protocolBlob);
  assert.deepEqual(refs.refs.map((x) => `${x.key}=${x.value}`), [
    'tSequenceFileName=%CustomerSeq%\\cust_tse_v2',
    'tdefaultEVAProt=%CustomerEvaDefProt%\\DTI\\DTI_990.evp',
  ]);
  const refsOf = (label) => results.refs.get(step(label).detail.protocolBlob).refs.map((x) => `${x.key}=${x.value}`);
  assert.deepEqual(refsOf('T1 cor'), ['tSequenceFileName=%ServiceSeq%\\rf_noise_spectrum']);
  assert.deepEqual(refsOf('Survey'), ['tSequenceFileName=%SiemensSeq%\\gre']);
  assert.deepEqual([...results.upgrades], [[step('Sag T1 FS').detail.protocolBlob, 'Synthetic upgrade note']]);
  assert.equal(missingCount(res.file, results), 0);
  source.close();
});

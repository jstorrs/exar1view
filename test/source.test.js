import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { openDb } from '../src/platform/sqlite.js';
import { inflateRaw } from '../src/platform/inflate.js';
import { createFileSource } from '../src/platform/source.js';
import { loadExar } from '../src/core/load.js';
import { displaySteps } from '../src/core/model.js';
import { diffParams } from '../src/core/paramdiff.js';
import { loadSql } from './sqljs.js';
import { buildExar, editExar } from './fixture/builder.js';

const FIXTURE = buildExar();

/** The fixture's measurement steps by label, and a source over `bytes`. */
async function open(bytes = FIXTURE, inflate = inflateRaw, capacity) {
  const opened = openDb(await loadSql(), bytes);
  const res = await loadExar(opened.db, inflateRaw, { id: 'f1', name: 'x.exar1', size: bytes.length });
  assert.ok(res.ok);
  const steps = res.file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs.flatMap((p) => displaySteps(p.body))));
  const blob = (label) => steps.find((s) => s.label === label).detail.protocolBlob;
  return { source: createFileSource(opened, inflate, capacity), blob, db: opened.db };
}

const asObjects = (blocks) => blocks.map((b) => Object.fromEntries(b));

test('a fixture protocol parses into its ASCCONV blocks', async () => {
  const { source, blob } = await open();
  const p = await source.protocol(blob('T2 TSE transversal'));
  assert.ok(p.ok, p.ok ? '' : p.error);
  assert.deepEqual(p.warnings, []);
  assert.equal(p.blocks.length, 2);
  assert.equal(p.blocks[0].get('alTR[0]'), '4000000');
  assert.equal(p.blocks[0].get('sWipMemBlock.tFree'), '"a#b = c"');
  assert.deepEqual(asObjects(p.blocks)[1], { lAverages: '2', 'sRXSPEC.lGain': '1' });
  source.close();
});

test('the two T1 steps share a blob; the T2 steps differ in key and churn parameters', async () => {
  const { source, blob } = await open();
  assert.equal(blob('T1 post'), blob('T1 native'));
  const [a, b] = await Promise.all([source.protocol(blob('T2 TSE transversal')), source.protocol(blob('T2 fast'))]);
  assert.ok(a.ok && b.ok);
  const diffs = diffParams(a.blocks, b.blocks);
  assert.deepEqual(diffs.map((d) => [d.block, d.key, d.tier, d.a, d.b]), [
    [0, 'tProtocolName', 'ignored', '"t2_tse_tra"', '"t2_tse_tra_fast"'],
    [0, 'alTR[0]', 'key', '4000000', '3000000'],
    [0, 'sKSpace.lBaseResolution', 'key', '384', '256'],
    [0, 'sPrepPulses.ucFatSat', 'key', '1', null],
    [0, 'sSliceArray.asSlice[0].sPosition.dTra', 'churn', '-10', '-14'],
    [0, 'sCoilSelectMeas.aRxCoilSelectData[0].asList[0].lElementSelected', 'churn', '1', '0'],
    [0, 'lTotalScanTimeSec', 'churn', '180', '75'],
    [1, 'lAverages', 'key', '2', '1'],
  ]);
  source.close();
});

test('requests share one read, and the cache keeps the most recently used', async () => {
  let reads = 0;
  const counting = (bytes) => { reads++; return inflateRaw(bytes); };
  const { source, blob } = await open(FIXTURE, counting, 2);
  const [x, y, z] = [blob('T2 fast'), blob('T1 post'), blob('Survey')];
  const first = source.protocol(x);
  assert.equal(source.protocol(x), first);
  await first;
  assert.equal(reads, 1);
  await source.protocol(y);
  await source.protocol(x); // x is now the most recent
  await source.protocol(z); // evicts y
  assert.equal(reads, 3);
  await source.protocol(x);
  assert.equal(reads, 3);
  await source.protocol(y);
  assert.equal(reads, 4);
  source.close();
});

test('failures come back as errors, without document text', async () => {
  const { source, blob, db } = await open();
  assert.deepEqual(await source.protocol('nope'), { ok: false, error: 'protocol content is missing' });
  // A step's own document is not a protocol.
  const [[stepHash]] = db.rows("select ContentHash from Instance where InstanceType = 'EdfMeasurementStep' limit 1");
  assert.deepEqual(await source.protocol(stepHash), { ok: false, error: 'expected a protocol, found EdfMeasurementStepContent' });
  source.close();

  const t2 = blob('T2 fast');
  const secret = 'SECRET-TEXT';
  /** A copy of the fixture whose T2 fast protocol content is `data`. */
  const withContent = (sqlValue) => editExar(FIXTURE, `update Content set Data = ${sqlValue} where Hash = '${t2}'`);
  const hex = (text) => `x'${deflateRawSync(Buffer.from(text)).toString('hex')}'`;
  const doc = (body) => hex(`EDF V1: ContentType=syngo.MR.ExamDataFoundation.Data.EdfProtocolContent;\r\n${JSON.stringify(body)}`);
  for (const [data, error] of [
    [doc({ Data: `<XProtocol>${secret}</XProtocol>`, Preview: {}, UpgradeInfo: '' }), 'protocol: no ASCCONV block'],
    [doc({ Data: 5, Preview: secret }), 'protocol Data is not text'],
    [hex(`EDF V1: ContentType=syngo.MR.ExamDataFoundation.Data.EdfProtocolContent;\r\n{"Data": "${secret}`), /^EdfProtocolContent: invalid JSON/],
    [`'${secret}'`, 'protocol content is not a blob'],
    ["x'ffffffff0102'", /^Content is not valid raw DEFLATE/],
  ]) {
    const { source: s } = await open(withContent(data));
    const p = await s.protocol(t2);
    assert.equal(p.ok, false);
    if (typeof error === 'string') assert.equal(p.error, error); else assert.match(p.error, error);
    assert.ok(!p.error.includes(secret));
    s.close();
  }
});

test('an ASCCONV warning comes back with the protocol', async () => {
  const { blob } = await open();
  const t2 = blob('T2 fast');
  const text = '### ASCCONV BEGIN ###\na = 1\nbad line\n### ASCCONV END ###';
  const body = `EDF V1: ContentType=syngo.MR.ExamDataFoundation.Data.EdfProtocolContent;\r\n${JSON.stringify({ Data: text })}`;
  const bytes = editExar(FIXTURE, `update Content set Data = x'${deflateRawSync(Buffer.from(body)).toString('hex')}' where Hash = '${t2}'`);
  const { source } = await open(bytes);
  const p = await source.protocol(t2);
  assert.ok(p.ok);
  assert.deepEqual(asObjects(p.blocks), [{ a: '1' }]);
  assert.deepEqual(p.warnings, ['ASCCONV block 1, line 2: expected KEY = VALUE; line skipped']);
  source.close();
});

test('close releases the database once; later requests fail', async () => {
  const opened = openDb(await loadSql(), FIXTURE);
  let closes = 0;
  const source = createFileSource({ db: opened.db, close: () => { closes++; opened.close(); } }, inflateRaw);
  source.close();
  source.close();
  assert.equal(closes, 1);
  assert.deepEqual(await source.protocol('x'), { ok: false, error: 'the file is closed' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/platform/sqlite.js';
import { inflateRaw } from '../src/platform/inflate.js';
import { loadExar } from '../src/core/load.js';
import { loadSql } from './sqljs.js';
import { deflateRawSync } from 'node:zlib';
import { buildExar, editExar } from './fixture/builder.js';
import { defaultSpec } from './fixture/spec.js';

/** Load fixture bytes the way the app does. */
async function load(bytes, onProgress) {
  const { db, close } = openDb(await loadSql(), bytes);
  try {
    return await loadExar(db, inflateRaw, { id: 'f1', name: 'test.exar1', size: bytes.length }, onProgress);
  } finally {
    close();
  }
}

const loaded = async (bytes = buildExar()) => {
  const res = await load(bytes);
  assert.ok(res.ok, res.ok ? '' : res.error);
  return res.file;
};

test('fixture loads into regions, exams and programs in file order, without problems', async () => {
  const file = await loaded();
  assert.deepEqual(file.problems, []);
  for (const r of file.regions) for (const e of r.exams) for (const p of e.programs) assert.deepEqual(p.problems, [], p.key);
  assert.equal(file.id, 'f1');
  assert.equal(file.name, 'test.exar1');
  assert.equal(file.baseline, 'TEST_BASELINE_20200101');
  assert.equal(file.changeset.comment, 'Save by CopyProgramsPipeline');
  assert.equal(file.changeset.dateTime, '2025-01-01 10:00:05.5000000');
  assert.deepEqual(
    file.regions.map((r) => [r.label, r.exams.map((e) => [e.label, e.programs.map((p) => p.label)])]),
    [
      ['Neuro', [['Head Routine', ['Localizer', 'Axial T2', 'Sagittal T1']], ['Empty Exam', []]]],
      ['Ortho', [['Kniegelenk', ['Knee PD']], ['Locked Exam', ['Shoulder Survey']]]],
    ],
  );
});

test('comments, tags, paths, keys and ids', async () => {
  const file = await loaded();
  const [neuro, ortho] = file.regions;
  assert.equal(neuro.comment, 'Neuro protocols');
  assert.equal(ortho.comment, null);
  const axial = neuro.exams[0].programs[1];
  assert.equal(axial.comment, 'Check the coil');
  assert.deepEqual(axial.tags, { SystemConfiguration: '021 / XR', Archive: 'True' });
  assert.deepEqual(axial.path, ['Neuro', 'Head Routine', 'Axial T2']);
  assert.match(axial.key, /^f1:p:[0-9a-f-]{36}$/);
  assert.equal(axial.key, `f1:p:${axial.ids.element}`);
  assert.match(neuro.key, /^f1:r:/);
  assert.match(neuro.exams[0].key, /^f1:e:/);
  assert.equal(axial.order, 'links');
  assert.deepEqual([axial.body, axial.conditions, axial.copyRefs, axial.problems], [[], [], [], []]);
  const keys = file.regions.flatMap((r) => [r.key, ...r.exams.flatMap((e) => [e.key, ...e.programs.map((p) => p.key)])]);
  assert.equal(new Set(keys).size, keys.length);
});

test('a directory password never reaches the model', async () => {
  const res = await load(buildExar());
  assert.ok(res.ok);
  assert.ok(!JSON.stringify(res).includes('SECRET-PW'));
});

test('progress starts with the head phase, then reports docs and ends at the total', async () => {
  const calls = [];
  const res = await load(buildExar(), (p) => calls.push(p));
  assert.ok(res.ok);
  assert.equal(calls[0].phase, 'head');
  const docs = calls.filter((p) => p.phase === 'docs');
  assert.ok(docs.length >= 1);
  assert.equal(docs.at(-1).done, docs.at(-1).total);
});

test('many documents are reported in several slices', async () => {
  const programs = Array.from({ length: 250 }, (_, i) => ({ label: `Program ${i}` }));
  const spec = { ...defaultSpec, root: { label: 'Root', dirs: [{ label: 'New Tree', dirs: [{ label: 'R', dirs: [{ label: 'E', programs }] }] }] } };
  const calls = [];
  const res = await load(buildExar(spec), (p) => calls.push(p));
  assert.ok(res.ok);
  assert.equal(res.file.regions[0].exams[0].programs.length, 250);
  const docs = calls.filter((p) => p.phase === 'docs');
  assert.ok(docs.length >= 3);
  assert.ok(docs.every((p, i) => i === 0 || p.done > docs[i - 1].done));
  assert.equal(docs.at(-1).done, docs.at(-1).total);
});

test('a directory document that fails to decode is an error that never quotes it', async () => {
  const broken = deflateRawSync(Buffer.from(
    'EDF V1: ContentType=syngo.MR.ExamDataFoundation.Data.EdfDirectoryContent;\r\n{"Password": "SECRET-PW"'));
  const bytes = editExar(buildExar(),
    `update Content set Data = x'${Buffer.from(broken).toString('hex')}' where Hash in (select ContentHash from Instance where InstanceType = 'EdfDirectory')`);
  const res = await load(bytes);
  assert.ok(res.ok);
  const errors = res.file.problems.filter((p) => p.level === 'error');
  assert.equal(errors.length, 8);
  assert.ok(!JSON.stringify(res).includes('SECRET-PW'));
});

test('a missing content row is a problem on the program, loading goes on', async () => {
  const bytes = buildExar();
  const { db, close } = openDb(await loadSql(), bytes);
  const [hash] = db.rows("select ContentHash from Instance where InstanceType = 'EdfProgram' limit 1")[0];
  close();
  const file = await loaded(editExar(bytes, `delete from Content where Hash = '${hash}'`));
  const programs = file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs));
  const bad = programs.filter((p) => p.problems.length);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].problems[0].level, 'error');
  assert.equal(bad[0].problems[0].where, bad[0].key);
  assert.equal(programs.length, 5);
});

test('a missing label string leaves the program in the tree with a placeholder label', async () => {
  const bytes = buildExar();
  const { db, close } = openDb(await loadSql(), bytes);
  const [hash] = db.rows(
    "select s.ContentHash from Instance p join Instance s on s.Element_id = p.LabelElement_id where p.InstanceType = 'EdfProgram' limit 1")[0];
  close();
  const file = await loaded(editExar(bytes, `delete from Content where Hash = '${hash}'`));
  const labels = file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs.map((p) => p.label)));
  assert.ok(labels.includes('(no label)'));
  assert.equal(labels.length, 5);
});

test('a content row that is not DEFLATE is a problem, not a failure', async () => {
  const bytes = buildExar();
  const file = await loaded(editExar(bytes, "update Content set Data = x'0102030405' where Hash in (select ContentHash from Instance where InstanceType = 'EdfProgram')"));
  const programs = file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs));
  assert.equal(programs.length, 5);
  assert.ok(programs.every((p) => p.problems.some((x) => x.level === 'error')));
});

test('fatal: a missing table', async () => {
  const res = await load(editExar(buildExar(), 'drop table Content'));
  assert.deepEqual(res, { ok: false, error: 'not an exar1 export: table Content is missing' });
});

test('fatal: two baselines look like a main database', async () => {
  const res = await load(editExar(buildExar(), "insert into Branch select 'OTHER_BASELINE', 'Latest', Head from Branch where Baseline <> '-'"));
  assert.equal(res.ok, false);
  assert.match(res.error, /found 2 branches; this looks like a main database \(exdb1\)/);
});

test('fatal: a map blob that is not a multiple of 32 bytes', async () => {
  const res = await load(editExar(buildExar(), "update ElementToInstanceMap set Data = x'00112233'"));
  assert.equal(res.ok, false);
  assert.match(res.error, /element map .*not a multiple of 32/);
});

test('an unexpected failure is reported, never thrown', async () => {
  const db = { rows() { throw new Error('boom'); } };
  const res = await loadExar(db, inflateRaw, { id: 'f1', name: 'x', size: 0 });
  assert.deepEqual(res, { ok: false, error: 'unexpected error: boom' });
});

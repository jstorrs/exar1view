import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/platform/sqlite.js';
import { FormatError } from '../src/core/errors.js';
import { checkSchema, loadHead, pickHead } from '../src/core/head.js';
import { loadSql } from './sqljs.js';
import { buildExar, editExar } from './fixture/builder.js';

const SQL = await loadSql();

/** A Db over fixture bytes, optionally damaged by SQL statements. */
function open(...statements) {
  const bytes = statements.length ? editExar(buildExar(), ...statements) : buildExar();
  return openDb(SQL, bytes).db;
}

test('checkSchema accepts the fixture and SlimInfo', () => {
  assert.deepEqual(checkSchema(open()), []);
  assert.deepEqual(checkSchema(open('create table SlimInfo (a)')), []);
});

test('checkSchema: an extra table is a warning', () => {
  const problems = checkSchema(open('create table Surprise (a)'));
  assert.equal(problems.length, 1);
  assert.equal(problems[0].level, 'warning');
  assert.match(problems[0].message, /Surprise/);
});

test('checkSchema: a missing table or column is fatal', () => {
  assert.throws(() => checkSchema(open('drop table Instance')), /table Instance is missing/);
  assert.throws(() => checkSchema(open('alter table Instance drop column Tags')), /table Instance lacks column Tags/);
  assert.throws(() => checkSchema(open('drop table Branch')), FormatError);
});

test('pickHead returns the baseline, head and resolved map (delta applied)', () => {
  const head = pickHead(open());
  assert.equal(head.baseline, 'TEST_BASELINE_20200101');
  assert.equal(head.changeset.comment, 'Save by CopyProgramsPipeline');
  assert.deepEqual(head.problems, []);
  // the base also holds the removed element; the delta drops it and swaps the structure
  assert.equal(head.map.size, 29);
});

test('pickHead: head with child change sets is a warning', () => {
  const head = pickHead(open(
    "insert into ChangeSet select '99999999-0000-4000-8000-000000000001', Author, DateTime, 'child', MachineName, Id, null, BaseElementMapId, DeltaElementMapId from ChangeSet where Comment like 'Save%'"));
  assert.equal(head.problems.length, 1);
  assert.match(head.problems[0].message, /child change sets/);
});

test('pickHead: a missing map row is fatal', () => {
  assert.throws(() => pickHead(open("delete from ElementToInstanceMap where Id like 'dddddddd-0000-4000-8000-000000000003'")), /delta element map .* is missing/);
});

test('loadHead skips old instance versions and the removed element', () => {
  const head = loadHead(open());
  assert.deepEqual(head.problems, []);
  const types = {};
  for (const row of head.instances.values()) types[row.type] = (types[row.type] ?? 0) + 1;
  assert.equal(types.EdfStructure, 1);
  assert.equal(types.EdfDirectory, 8);
  assert.equal(types.EdfProgram, 5);
});

test('loadHead: mapped instance missing, wrong Element_id, unknown type: warnings, rows skipped', () => {
  const count = loadHead(open()).instances.size;
  const missing = loadHead(open("delete from Instance where InstanceType = 'EdfProgram' and Id in (select Id from Instance where InstanceType = 'EdfProgram' limit 1)"));
  assert.equal(missing.instances.size, count - 1);
  assert.match(missing.problems[0].message, /not in the Instance table/);

  const wrong = loadHead(open("update Instance set Element_id = '77777777-0000-4000-8000-000000000001' where Id in (select Id from Instance where InstanceType = 'EdfProgram' limit 1)"));
  assert.equal(wrong.instances.size, count - 1);
  assert.match(wrong.problems[0].message, /belongs to element/);

  const unknown = loadHead(open("update Instance set InstanceType = 'EdfMystery' where Id in (select Id from Instance where InstanceType = 'EdfProgram' limit 1)"));
  assert.equal(unknown.instances.size, count - 1);
  assert.match(unknown.problems[0].message, /unknown InstanceType/);
});

test('loadHead: bad tags are a warning and become empty', () => {
  const head = loadHead(open("update Instance set Tags = 'oops' where Id in (select Id from Instance where InstanceType = 'EdfProgram' limit 1)"));
  assert.equal(head.problems.length, 1);
  assert.match(head.problems[0].message, /malformed tags/);
  assert.equal(head.instances.size, loadHead(open()).instances.size);
});

test('pickHead: no branch other than "-" is fatal', () => {
  assert.throws(() => pickHead(open("delete from Branch where Baseline <> '-'")), /no branch other than/);
});

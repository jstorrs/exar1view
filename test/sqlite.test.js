import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/platform/sqlite.js';
import { loadSql } from './sqljs.js';

/** Bytes of a small database: t(id, name, data BLOB). */
async function sampleBytes() {
  const SQL = await loadSql();
  const db = new SQL.Database();
  db.run('create table t (id integer, name text, data blob)');
  db.run('insert into t values (1, ?, ?)', ['one', new Uint8Array([1, 2, 3])]);
  db.run("insert into t values (2, 'two', null)");
  const bytes = db.export();
  db.close();
  return bytes;
}

test('openDb returns rows, blobs as Uint8Array', async () => {
  const SQL = await loadSql();
  const { db, wal, close } = openDb(SQL, await sampleBytes());
  assert.equal(wal, false);
  const rows = db.rows('select id, name, data from t order by id');
  assert.deepEqual(rows, [[1, 'one', new Uint8Array([1, 2, 3])], [2, 'two', null]]);
  assert.ok(rows[0][2] instanceof Uint8Array);
  close();
});

test('rows binds params', async () => {
  const SQL = await loadSql();
  const { db, close } = openDb(SQL, await sampleBytes());
  assert.deepEqual(db.rows('select name from t where id = ? and name = ?', [2, 'two']), [['two']]);
  assert.deepEqual(db.rows('select name from t where id = ?', [99]), []);
  close();
});

test('non-SQLite bytes throw a clear error', async () => {
  const SQL = await loadSql();
  assert.throws(() => openDb(SQL, new TextEncoder().encode('hello world'.repeat(20))), /Not a SQLite file/);
  assert.throws(() => openDb(SQL, new Uint8Array(0)), /Not a SQLite file/);
});

test('WAL header bytes are patched in the copy and flagged', async () => {
  const SQL = await loadSql();
  const bytes = await sampleBytes();
  bytes[18] = 2;
  bytes[19] = 2;
  const { db, wal, close } = openDb(SQL, bytes);
  assert.equal(wal, true);
  assert.deepEqual(db.rows('select count(*) from t'), [[2]]);
  assert.equal(bytes[18], 2, 'caller bytes untouched');
  close();
});

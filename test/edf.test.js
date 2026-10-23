// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeDoc, decodeBytes, INSTANCE_TYPES, contentTypeOf, parseTags, labelText } from '../src/core/edf.js';
import { obj, str } from '../src/core/json.js';
import { FormatError } from '../src/core/errors.js';

const hdr = (/** @type {string} */ t) => `EDF V1: ContentType=syngo.MR.ExamDataFoundation.Data.${t};\r\n`;

const stringDoc = hdr('EdfStringContent') + JSON.stringify({
  $id: '1',
  $type: 'Foo.EdfStringContent, Foo',
  Dates: { $id: '2', en: '2020-01-01' },
  Texts: { $id: '3', $type: 'Dict', en: 'Brain', de: 'Gehirn' },
});

test('decodeDoc parses header and normalizes body', () => {
  const d = decodeDoc(stringDoc);
  assert.equal(d.type, 'EdfStringContent');
  assert.deepEqual(d.body, { Dates: { en: '2020-01-01' }, Texts: { en: 'Brain', de: 'Gehirn' } });
});

test('decodeDoc nests $values arrays', () => {
  const d = decodeDoc(hdr('EdfStructureContent') + '{"$id":"1","Children":{"$id":"2","$values":[{"$id":"3","Id":"x"}]}}');
  assert.deepEqual(d.body, { Children: [{ Id: 'x' }] });
});

test('decodeDoc strips a BOM and decodeBytes decodes UTF-8', () => {
  assert.equal(decodeDoc('\ufeff' + hdr('EdfStringContent') + '{}').type, 'EdfStringContent');
  const bytes = new TextEncoder().encode('\ufeff' + hdr('EdfStringContent') + '{"Texts":{"en":"Grüße"}}');
  assert.deepEqual(decodeBytes(bytes).body, { Texts: { en: 'Grüße' } });
});

test('decodeDoc rejects bad headers and bodies', () => {
  assert.throws(() => decodeDoc('{}'), /header line is missing or malformed/);
  assert.throws(() => decodeDoc(hdr('EdfStringContent').replace('\r\n', '\n') + '{}'), /header line is missing or malformed/);
  assert.throws(() => decodeDoc(hdr('EdfStringContent').replace('syngo.MR', 'syngo.CT') + '{}'), /header line is missing or malformed/);
  assert.throws(() => decodeDoc(' ' + hdr('EdfStringContent') + '{}'), /header line is missing or malformed/);
  assert.throws(() => decodeDoc(hdr('EdfStringContent') + '{nope'), /EdfStringContent: invalid JSON/);
  assert.throws(() => decodeDoc(hdr('Bogus') + '{}'), /unknown EDF content type "Bogus"/);
  assert.throws(() => decodeDoc(hdr('EdfStringContent') + '[]'), /expected a JSON object/);
});

test('decodeDoc accepts a $ref; it fails only when read', () => {
  const { body } = decodeDoc(hdr('EdfProgramContent') + '{"a":{"$ref":"1"},"b":"x"}');
  assert.throws(() => obj(body, 'a', 'doc'), /unresolved Json.NET \$ref/);
  assert.equal(str(body, 'b', 'doc'), 'x');
});

test('decode errors never quote document text', () => {
  const bad = hdr('EdfDirectoryContent') + '{"Password": hunter2}';
  assert.throws(() => decodeDoc(bad), (e) => e instanceof FormatError && !e.message.includes('hunter2'));
  assert.throws(() => decodeDoc('hunter2'), (e) => e instanceof FormatError && !e.message.includes('hunter2'));
});

test('decodeDoc reports excessive nesting', () => {
  const deep = '['.repeat(100000) + ']'.repeat(100000);
  assert.throws(() => decodeDoc(hdr('EdfStringContent') + '{"a":' + deep + '}'), /nested too deeply|invalid JSON/);
  const nested = '{"a":'.repeat(20000) + '1' + '}'.repeat(20000);
  assert.throws(() => decodeDoc(hdr('EdfStringContent') + nested), /nested too deeply/);
});

test('decodeBytes rejects invalid UTF-8', () => {
  const head = new TextEncoder().encode(hdr('EdfStringContent') + '{"Texts":{"en":"a');
  const bytes = Uint8Array.from([...head, 0xfc, 0xdf, ...new TextEncoder().encode('"}}')]);
  assert.throws(() => decodeBytes(bytes), /not valid UTF-8/);
});

test('instance types and content types', () => {
  assert.equal(INSTANCE_TYPES.length, 13);
  assert.equal(new Set(INSTANCE_TYPES).size, 13);
  assert.equal(contentTypeOf('EdfProgram'), 'EdfProgramContent');
});

test('parseTags', () => {
  assert.deepEqual(parseTags(null), {});
  assert.deepEqual(parseTags(''), {});
  assert.deepEqual(parseTags('#A|1#B|'), { A: '1', B: '' });
  assert.deepEqual(parseTags('#A|x|y'), { A: 'x|y' });
  assert.deepEqual(parseTags('#A b|c d'), { 'A b': 'c d' });
});

test('parseTags rejects malformed and duplicate', () => {
  for (const bad of ['A|1', '#A', '#|1', '#A|1#', '#A|1#B', '##A|1']) {
    assert.throws(() => parseTags(bad, 'step'), /^FormatError: step: malformed tags/, bad);
  }
  assert.throws(() => parseTags('#A|1#A|2'), /duplicate tag "A"/);
});

test('labelText', () => {
  assert.equal(labelText({ Texts: { de: 'Hallo', en: 'Hello' } }), 'Hello');
  assert.equal(labelText({ Texts: { de: '', fr: 'Salut', en: '' } }), 'Salut');
  assert.equal(labelText({ Texts: { de: '' } }), '');
  assert.equal(labelText({ Texts: {} }), '');
  assert.throws(() => labelText({ Texts: { en: 1 } }), FormatError);
  assert.throws(() => labelText({}), FormatError);
});

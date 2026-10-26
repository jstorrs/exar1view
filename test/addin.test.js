// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addInName, addInOf } from '../src/core/addin.js';

test('addInName: an i18n resource key gives its last segment unchanged; a plain name as is', () => {
  assert.equal(addInName('i18n://syngo.MR.ExamAddIn.Configurations/Resource/AutoAlignScout'), 'AutoAlignScout');
  assert.equal(addInName('i18n://x/Resource/BreastDot'), 'BreastDot');
  assert.equal(addInName('WIP 1419 SRC'), 'WIP 1419 SRC');
  assert.equal(addInName('QISS Patient View'), 'QISS Patient View');
  assert.equal(addInName('i18n://x/'), 'i18n://x/');
  assert.equal(addInName(''), null);
  assert.equal(addInName(null), null);
  assert.equal(addInName(5), null);
});

test('addInOf: the Name of an add-in document; another type is an error', () => {
  assert.deepEqual(addInOf({ type: 'EdfAddInConfigContent', body: { Data: '<x/>', Name: 'i18n://a/Resource/Spine', VoiceCommands: {} } }),
    { ok: true, name: 'Spine', raw: 'i18n://a/Resource/Spine' });
  assert.deepEqual(addInOf({ type: 'EdfAddInConfigContent', body: { Data: '<x/>' } }), { ok: true, name: null, raw: null });
  assert.deepEqual(addInOf({ type: 'EdfAddInConfigContent', body: { Name: 3 } }), { ok: true, name: null, raw: null });
  assert.deepEqual(addInOf({ type: 'EdfProtocolContent', body: { Name: 'x' } }), { ok: false, error: 'expected an add-in, found EdfProtocolContent' });
});

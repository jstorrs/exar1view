// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controllerAndEva, evaStringTable, paramValues, xprotocolSections } from '../src/core/xprotocol.js';

test('evaStringTable: reads code → text pairs of the first table', () => {
  const t = evaStringTable('<XProtocol> <EVAStringTable> \n  {\n    2 \n    400 "Alpha" \n    401 "Beta" \n  }\n<EVAStringTable> { 1 400 "Other" }');
  assert.deepEqual([...t], [[400, 'Alpha'], [401, 'Beta']]);
});

test('evaStringTable: "" inside a string is a quote; a string may hold braces and digits', () => {
  const t = evaStringTable('<EVAStringTable> { 2 7 "say ""hi"" {1} 8 ""x" 8 "" }');
  assert.deepEqual([...t], [[7, 'say "hi" {1} 8 "x'], [8, '']]);
});

test('evaStringTable: no table or a malformed one gives what was read', () => {
  assert.equal(evaStringTable('').size, 0);
  assert.equal(evaStringTable('<XProtocol> { }').size, 0);
  assert.equal(evaStringTable('<EVAStringTable> { x }').size, 0);
  assert.deepEqual([...evaStringTable('<EVAStringTable> { 3 1 "a" 2 oops 3 "c" }')], [[1, 'a']]);
  assert.equal(evaStringTable('<EVAStringTable> { 2 400 "ab""cd').size, 0);
  assert.deepEqual([...evaStringTable('<EVAStringTable> { 1 1 "a" 2 "b" }')], [[1, 'a']]);
});

const SAMPLE = `<XProtocol> {
  <Name> "Sample"
  <ParamMap."Props"> {
    <ParamBool."Flag"> { }
    <ParamLong."Count"> { <Label> "n" <Default> 7 }
    <ParamDouble."Gain"> { }
    <ParamString."Text"> { "say ""hi"" there" 5 }
    <ParamString."Blank"> { }
    <ParamChoice."Mode"> { <Default> "b" <Limit> { "a" "b" } }
    <ParamChoice."NoVal"> { <Limit> { "a" } }
    <ParamLong."Set"> { 3 <Default> 9 }
    <ParamMap."Inner"> { <ParamLong."Deep"> { 4 } }
    <ParamMap.""> { <ParamBool."Anon"> { true } }
    <ParamArray."List"> { { 1 2 } }
  }
  <PipeService."Svc"> {
    <ParamFunctor."Fn"> { <ParamLong."Arg"> { 2 } }
    <Event."Ev"> { <ParamLong."Skipped"> { 1 } }
  }
}`;

test('paramValues: flattens leaf parameters to dotted paths with effective values', () => {
  const { name, values } = paramValues(SAMPLE);
  assert.equal(name, 'Sample');
  assert.deepEqual(Object.fromEntries(values), {
    'Props.Flag': 'false',
    'Props.Count': '7',
    'Props.Gain': '0',
    'Props.Text': 'say "hi" there',
    'Props.Blank': '',
    'Props.Mode': 'b',
    'Props.Set': '3',
    'Props.Inner.Deep': '4',
    'Props.Anon': 'true',
    'Props.List': '["1", "2"]',
    'Svc.Fn.Arg': '2',
  });
});

test('paramValues: malformed or empty input never throws', () => {
  for (const bad of ['', '<XProtocol>', '<XProtocol> {', '<XProtocol> { <ParamLong."A"> { 1 ', '} } {', '<XProtocol> { <ParamLong."A"> "x', 'garbage < > "', '{'.repeat(50000)]) {
    assert.doesNotThrow(() => paramValues(bad));
  }
  assert.equal(paramValues('nothing here').values.size, 0);
  assert.deepEqual([...paramValues('<XProtocol> { <ParamLong."A"> { 1 ').values], [['A', '1']]);
});

test('xprotocolSections: XProtocol and ASCCONV sections in order', () => {
  const secs = xprotocolSections('<XProtocol> { a }\n<XProtocol> { b }\n### ASCCONV BEGIN ver=1 ###\nx = 1\n### ASCCONV END ###\ntail');
  assert.deepEqual(secs.map((s) => s.kind), ['xprotocol', 'xprotocol', 'ascconv']);
  assert.equal(secs[0].text, '<XProtocol> { a }\n');
  assert.equal(secs[2].text, 'x = 1\n');
  assert.deepEqual(xprotocolSections('no sections'), []);
  assert.equal(xprotocolSections('### ASCCONV BEGIN\nx = 1')[0].text, 'x = 1');
});

test('controllerAndEva: the controller section and the XProtocol just before ASCCONV block 0', () => {
  const ctrl = '<XProtocol> { <Name> "MultiStep Controller" <ParamLong."Q"> { 1 } }\n';
  const other = '<XProtocol> { <Name> "Other" <ParamLong."X"> { 2 } }\n';
  const eva = '<XProtocol> { <Name> "EVA" <ParamLong."Y"> { 3 } }\n';
  const asc = '### ASCCONV BEGIN ###\na = 1\n### ASCCONV END ###\n';
  const r = controllerAndEva(ctrl + other + eva + asc + other + asc);
  assert.deepEqual([...r.controller], [['Q', '1']]);
  assert.deepEqual([...r.eva], [['Y', '3']]);
  const none = controllerAndEva('plain');
  assert.equal(none.controller.size + none.eva.size, 0);
  assert.equal(controllerAndEva(ctrl + eva).eva.size, 0);
});

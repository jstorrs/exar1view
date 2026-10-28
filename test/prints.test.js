// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/platform/sqlite.js';
import { inflateRaw } from '../src/platform/inflate.js';
import { loadExar } from '../src/core/load.js';
import { findPrintPairs, readPrint, joinPrint } from '../tools/cards/prints.js';
import { buildExar } from './fixture/builder.js';
import { loadSql } from './sqljs.js';

const meas = (name) => ({ name, kind: /** @type {const} */ ('Measurement') });

/** Region Reg, exam Exam, program Prog with steps Alpha, Beta, Alpha (a repeated label), Pause. */
async function loaded() {
  const bytes = buildExar({
    baseline: 'TEST_BASELINE_20200101',
    root: {
      label: 'Root',
      dirs: [{
        label: 'New Tree',
        dirs: [{
          label: 'Reg',
          dirs: [{
            label: 'Exam',
            programs: [{
              label: 'Prog',
              steps: [
                { ...meas('a1'), label: 'Alpha' }, { ...meas('b'), label: 'Beta' },
                { ...meas('a2'), label: 'Alpha' }, { name: 'p', kind: 'Pause', label: 'Alpha' },
              ],
            }],
          }],
        }],
      }],
    },
  });
  const { db, close } = openDb(await loadSql(), bytes);
  try {
    const res = await loadExar(db, inflateRaw, { id: 'f1', name: 'test.exar1', size: bytes.length });
    assert.ok(res.ok);
    return res.file;
  } finally {
    close();
  }
}

const protocol = (path, body = '') => `    <Protocol Id="x">
      <HeaderTitle>Title</HeaderTitle>
      <SubStep>
        <ProtHeaderInfo>
          <HeaderProtPath>${path}</HeaderProtPath>
          <HeaderProperty>TA: 1:00 PM: REF </HeaderProperty>
        </ProtHeaderInfo>${body}
      </SubStep>
    </Protocol>
`;

const card = `
        <Card ID="ID_1" name="Routine">
          <ProtParameter>
            <Label>TR</Label>
            <ValueAndUnit>500 ms </ValueAndUnit>
          </ProtParameter>
          <ProtParameter GroupId="1">
            <Label>Name &amp; &lt;tag&gt;</Label>
            <ValueAndUnit>a &quot;b&quot;  </ValueAndUnit>
          </ProtParameter>
        </Card>`;

const print = (...protocols) => `﻿<?xml version="1.0" encoding="utf-8"?>
<PrintOut>
  <PrintTOC><TOC><root name="\\\\Tree"><region name="Reg" /></root></TOC></PrintTOC>
  <PrintProtocols>
${protocols.join('')}  </PrintProtocols>
</PrintOut>`;

const read = (text) => {
  const res = readPrint(text);
  assert.ok(res.ok);
  return res.protocols;
};

test('readPrint reads path, header and cards, keeping values exactly', () => {
  const [p] = read(print(protocol('\\\\Tree\\Reg\\Exam\\Prog\\Alpha *', card)));
  assert.deepEqual(p.path, ['Tree', 'Reg', 'Exam', 'Prog', 'Alpha']);
  assert.deepEqual(p.header, { path: '\\\\Tree\\Reg\\Exam\\Prog\\Alpha *', lines: ['TA: 1:00 PM: REF '] });
  assert.deepEqual(p.cards, [{
    name: 'Routine',
    params: [
      { label: 'TR', value: '500 ms ', grouped: false },
      { label: 'Name & <tag>', value: 'a "b"  ', grouped: true },
    ],
  }]);
});

test('readPrint decodes entities in the path and gives protocols in print order', () => {
  const ps = read(print(protocol('\\\\T\\R\\E\\P &lt; 1\\One'), protocol('\\\\T\\R\\E\\P\\Two')));
  assert.deepEqual(ps.map((p) => p.path.slice(3)), [['P < 1', 'One'], ['P', 'Two']]);
});

test('readPrint reports an unclosed protocol and one without a path, without quoting the text', () => {
  const unclosed = readPrint('<PrintOut><Protocol Id="secret">');
  assert.equal(unclosed.ok, false);
  assert.ok(!unclosed.ok && !unclosed.error.includes('secret'));
  assert.equal(readPrint('<Protocol Id="x"><SubStep></SubStep></Protocol>').ok, false);
  assert.deepEqual(readPrint(print()), { ok: true, protocols: [] });
});

test('joinPrint pairs by labels and occurrence, and counts what is left over', async () => {
  const file = await loaded();
  const ps = read(print(
    protocol('\\\\Tree\\Reg\\Exam\\Prog\\Alpha *', card),
    protocol('\\\\Tree\\Reg\\Exam\\Prog\\Alpha'),
    protocol('\\\\Tree\\Reg\\Exam\\Prog\\Alpha'), // a third Alpha: no such step
    protocol('\\\\Tree\\Reg\\Exam\\Elsewhere\\Beta'),
    protocol('\\\\Tree\\Reg\\Exam\\Prog'), // not a step path
  ));
  const { pairs, unmatchedSteps, unmatchedProtocols } = joinPrint(file, ps);
  const [alpha1, beta, alpha2] = file.regions[0].exams[0].programs[0].body.map((n) => (n.type === 'step' ? n.step : assert.fail()));
  assert.deepEqual(pairs, [{ step: alpha1, protocol: ps[0] }, { step: alpha2, protocol: ps[1] }]);
  assert.notEqual(alpha1.key, alpha2.key);
  assert.deepEqual(unmatchedSteps, [beta]);
  assert.deepEqual(unmatchedProtocols, [ps[2], ps[3], ps[4]]);
});

test('findPrintPairs finds exar1 files with a sibling xml, once by real path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prints-'));
  try {
    mkdirSync(join(dir, 'sub'));
    for (const f of ['a.exar1', 'a.xml', 'sub/b.exar1', 'sub/b.xml', 'lonely.exar1', 'only.xml']) writeFileSync(join(dir, f), '');
    symlinkSync(join(dir, 'a.exar1'), join(dir, 'z.exar1'));
    writeFileSync(join(dir, 'z.xml'), '');
    symlinkSync(join(dir, 'gone.exar1'), join(dir, 'dangling.exar1'));
    writeFileSync(join(dir, 'dangling.xml'), '');
    assert.deepEqual(findPrintPairs(dir), [
      { exar1: join(dir, 'a.exar1'), xml: join(dir, 'a.xml') },
      { exar1: join(dir, 'sub/b.exar1'), xml: join(dir, 'sub/b.xml') },
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

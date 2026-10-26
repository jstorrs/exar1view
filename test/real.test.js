// Integration test over real exports. They are confidential site data and are never committed:
// set EXAR1_DIR to a directory holding them (searched recursively), e.g.
//   EXAR1_DIR=/path/to/exports npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { openDb } from '../src/platform/sqlite.js';
import { inflateRaw } from '../src/platform/inflate.js';
import { createFileSource } from '../src/platform/source.js';
import { loadExar } from '../src/core/load.js';
import { displaySteps } from '../src/core/model.js';
import { sequenceName } from '../src/core/diffview.js';
import { extractReferences } from '../src/core/seqrefs.js';
import { comparePrograms } from '../src/core/progdiff.js';
import { loadSql } from './sqljs.js';

// Per basename: (dirs, programs, empty, branching, linear, conditions, steps,
//  steps by kind M/P/I/D/W/S/J, copy refs, broken, step comments, protocol blobs, protocol hashes)
const EXPECTED = {
  'BBH_2025-04-29.exar1': [11, 21, 0, 0, 21, 0, 354, [278, 49, 27, 0, 0, 0, 0], 109, 0, 64, 191, 191],
  'ARCHIVES.exar1': [16, 27, 0, 0, 27, 0, 207, [183, 24, 0, 0, 0, 0, 0], 3, 0, 40, 157, 157],
  'CARDIAC RESEARCH.exar1': [33, 62, 0, 0, 62, 0, 847, [717, 130, 0, 0, 0, 0, 0], 128, 0, 185, 625, 624],
  'CARDIAC.exar1': [35, 86, 0, 3, 83, 7, 1816, [1406, 385, 0, 2, 3, 10, 10], 583, 2, 616, 1043, 1021],
  'NCH.exar1': [33, 205, 0, 31, 174, 44, 3400, [2834, 383, 38, 14, 31, 50, 50], 360, 5, 677, 2111, 2096],
  'PLAYGROUND.exar1': [52, 166, 0, 24, 142, 43, 2620, [2143, 343, 11, 13, 24, 43, 43], 598, 0, 270, 1562, 1558],
  'RESEARCH 2026.exar1': [78, 97, 0, 1, 96, 1, 1677, [1470, 177, 19, 0, 1, 5, 5], 367, 4, 313, 966, 959],
  'RESEARCHOLD.exar1': [213, 436, 2, 7, 427, 28, 5439, [4735, 549, 31, 13, 7, 52, 52], 876, 11, 1512, 3438, 3417],
  'SIEMENS.exar1': [132, 350, 0, 28, 322, 66, 3728, [2909, 476, 51, 26, 28, 119, 119], 370, 0, 61, 2085, 2084],
};

const KINDS = ['Measurement', 'Pause', 'Interaction', 'Decision', 'Workflow', 'Split', 'Join'];

/** The count tuple of the table, computed from the model. */
function counts(file) {
  const programs = file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs));
  const steps = programs.flatMap((p) => displaySteps(p.body));
  const copies = programs.flatMap((p) => p.copyRefs);
  const measurements = steps.filter((s) => s.kind === 'Measurement');
  const distinct = (values) => new Set(values.filter((v) => v !== null)).size;
  const isLinear = (p) => p.body.every((n) => n.type === 'step');
  return [
    // Directories: every region and exam, plus Root and New Tree. A file whose programs sit outside
    // an exam or region would get synthetic ones here; that is reported as a file problem, which
    // this test requires to be empty, so the count stays exact.
    file.regions.length + file.regions.reduce((n, r) => n + r.exams.length, 0) + 2,
    programs.length,
    programs.filter((p) => p.body.length === 0).length,
    programs.filter((p) => !isLinear(p)).length,
    programs.filter((p) => p.body.length > 0 && isLinear(p)).length,
    programs.reduce((n, p) => n + p.conditions.length, 0),
    steps.length,
    KINDS.map((k) => steps.filter((s) => s.kind === k).length),
    copies.length,
    copies.filter((c) => c.broken).length,
    steps.filter((s) => s.comment !== null).length,
    distinct(measurements.map((s) => s.detail.protocolBlob)),
    distinct(measurements.map((s) => s.detail.protocolHash)),
  ];
}

/** Counts of the nodes of a comparison that are not plain same: one-sided, with diffs or a differing protocol. */
function changedNodes(body) {
  let n = 0;
  for (const c of body) {
    if (c.in !== 'both' || c.diffs.length > 0 || (c.type === 'step' && c.protocol === 'differs')) n++;
    if (c.type === 'fork') {
      for (const b of c.branches) {
        if (b.in !== 'both' || b.diffs.length > 0) n++;
        n += changedNodes(b.body);
      }
    }
  }
  return n;
}

/** Distinct `*.exar1` files under `dir` by real path (symlinks exist), in a stable order. */
function findExports(dir) {
  const seen = new Set();
  const found = [];
  for (const rel of readdirSync(dir, { recursive: true }).sort()) {
    if (!rel.endsWith('.exar1')) continue;
    const path = join(dir, rel);
    let real;
    try {
      real = realpathSync(path);
    } catch {
      continue; // dangling symlink
    }
    if (seen.has(real)) continue;
    seen.add(real);
    found.push({ rel, path: real });
  }
  return found;
}

async function load(path) {
  const bytes = new Uint8Array(readFileSync(path));
  const { db, close } = openDb(await loadSql(), bytes);
  try {
    return await loadExar(db, inflateRaw, { id: 'f1', name: basename(path), size: bytes.length });
  } finally {
    close();
  }
}

const dir = process.env.EXAR1_DIR;

if (!dir) {
  test('real exports', { skip: 'EXAR1_DIR is not set' }, () => {});
} else {
  const exports = findExports(dir);
  if (exports.length === 0) test('real exports', { skip: `no .exar1 files under EXAR1_DIR` }, () => {});
  for (const { rel, path } of exports) {
    test(rel, async () => {
      const res = await load(path);
      assert.ok(res.ok, res.ok ? '' : res.error);
      const { file } = res;
      const programs = file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs));

      assert.deepEqual(file.problems, []);
      for (const p of programs) {
        assert.deepEqual(p.problems, [], p.key);
        assert.notEqual(p.order, 'rank', p.key);
        for (const s of displaySteps(p.body)) assert.deepEqual(s.problems, [], s.key);
      }
      assert.ok(!JSON.stringify(file).includes('"Password"'));

      // A program compared with itself is all same.
      for (const p of programs) {
        const cmp = comparePrograms(p, p);
        assert.equal(cmp.header.length, 0, p.key);
        assert.equal(changedNodes(cmp.body), 0, p.key);
      }

      // Unknown basenames are only checked for problems.
      const expected = EXPECTED[basename(path)] ?? EXPECTED[basename(rel)];
      if (expected) assert.deepEqual(counts(file), expected);
    });
  }

  // Every protocol of BBH through the compare panel's path: one clean main block each.
  const bbh = exports.find(({ path }) => basename(path) === 'BBH_2025-04-29.exar1');
  if (bbh) {
    test(`${bbh.rel}: every protocol parses`, async (t) => {
      const bytes = new Uint8Array(readFileSync(bbh.path));
      const opened = openDb(await loadSql(), bytes);
      const res = await loadExar(opened.db, inflateRaw, { id: 'f1', name: 'bbh', size: bytes.length });
      assert.ok(res.ok);
      const steps = res.file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs.flatMap((p) => displaySteps(p.body))));
      const blobs = [...new Set(steps.flatMap((s) => (s.kind === 'Measurement' && s.detail.protocolBlob ? [s.detail.protocolBlob] : [])))];
      const source = createFileSource(opened, inflateRaw);
      const t0 = performance.now();
      try {
        for (const blob of blobs) {
          const p = await source.protocol(blob);
          assert.ok(p.ok, p.ok ? '' : p.error);
          assert.deepEqual(p.warnings, []);
          assert.equal(p.blocks.length, 1);
          assert.ok(p.blocks[0].has('tSequenceFileName'));
          const t = await source.text(blob);
          assert.ok(t.ok, t.ok ? '' : t.error);
          const seqs = extractReferences(t.text).filter((r) => r.key === 'tSequenceFileName');
          assert.deepEqual(seqs.map((r) => r.value), [sequenceName(p.blocks)]);
        }
      } finally {
        source.close();
      }
      assert.equal(blobs.length, 191);
      t.diagnostic(`${blobs.length} protocols in ${(performance.now() - t0).toFixed(0)} ms`);
    });
  }
}

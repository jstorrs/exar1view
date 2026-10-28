// @ts-check
// Regression guard for the card catalog: with EXAR1_DIR holding exports that have sibling scanner
// prints (X.exar1 and X.xml), builds the cards of every joined step with the shipped CATALOG and
// compares them with the print. Prints are confidential: the output holds counts and scanner card
// and label names only, never printed values or sequence names.
//   EXAR1_DIR=/path/to/exports node --test test/printcoverage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { openDb } from '../src/platform/sqlite.js';
import { inflateRaw } from '../src/platform/inflate.js';
import { createFileSource } from '../src/platform/source.js';
import { loadExar } from '../src/core/load.js';
import { cardSources } from '../src/core/cardsource.js';
import { buildCards } from '../src/core/cards.js';
import { CATALOG } from '../src/core/catalog.js';
import { findPrintPairs, readPrint, joinPrint } from '../tools/cards/prints.js';
import { observationOf } from '../tools/cards/layout.js';
import { loadSql } from './sqljs.js';

/** Least share of standard/service-sequence printed lines the generated cards must reproduce. */
const MIN_COVERAGE = 0.78;
const PREFIXES = ['%SiemensSeq%', '%AdjustSeq%', '%ServiceSeq%'];
/** The labels of the group header lines, by group kind (the scanner's vocabulary). */
const HEADERS = { slice: 'Slice group', slab: 'Slab group', navigator: 'Navigator', sat: 'Sat. region', inversion: 'Graph. Sel. Inversion' };
const TOP = 20;
const PREFIX = /^(! |  )(?=\S)/;
/** The header line above the cards: TA, positioning mode, voxel size or VoI, PAT, SNR, the scanner's sequence name, substep. */
const HEADER = /^TA: (?<ta>.*?) PM: (?<pm>\S+) (?:Voxel size: (?<voxel>\S+) mm|VoI: (?<voi>.*?) mm)(?:PAT: (?<pat>\S+) )?Rel\. SNR: (?<snr>\S+)  : (?<seq>.*?)\s*(?:\| Substep: (?<substep>\S+))?$/;
const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/;

/** Whether two value texts are equal after trimEnd, or numbers with equal values and the same unit. @param {string} a @param {string} b */
function sameText(a, b) {
  const [x, y] = [a.trimEnd(), b.trimEnd()];
  if (x === y) return true;
  const [m, n] = [NUMBER.exec(x), NUMBER.exec(y)];
  return m !== null && n !== null && m[2] === n[2] && parseFloat(m[1]) === parseFloat(n[1]);
}

/** Whether two texts of numbers separated by × have equal values. @param {string | null} a @param {string | null} b */
function sameNumbers(a, b) {
  if (a === null || b === null) return a === b;
  const [x, y] = [a, b].map((t) => t.split('×').map(parseFloat));
  return x.length === y.length && x.every((n, i) => n === y[i]);
}

/** Lines by (label, occurrence of that label in the card), labels as shown. @param {{ label: string }[]} lines */
function keyed(lines) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return lines.map((l) => {
    const label = l.label.trimEnd();
    const k = seen.get(label) ?? 0;
    seen.set(label, k + 1);
    return { label, key: `${label}\0${k}` };
  });
}

/** @param {{ label: string }[]} lines @param {string} header */
const blocks = (lines, header) => lines.filter((l) => l.label.trimEnd().replace(PREFIX, '') === header).length;

/** @typedef {{ lines: number, hit: number }} Tally */
/** @param {Map<string, Tally>} m @param {string} k @param {boolean} hit */
function tally(m, k, hit) {
  const t = m.get(k) ?? { lines: 0, hit: 0 };
  t.lines++;
  if (hit) t.hit++;
  m.set(k, t);
}
/** @param {Map<string, number>} m @param {string} k */
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const pct = (/** @type {number} */ a, /** @type {number} */ b) => (b ? `${((100 * a) / b).toFixed(2)}%` : '-');

const dir = process.env.EXAR1_DIR;
const pairs = dir ? findPrintPairs(dir) : [];

if (!dir) {
  test('print coverage', { skip: 'EXAR1_DIR is not set' }, () => {});
} else if (pairs.length === 0) {
  test('print coverage', { skip: 'no .xml prints beside the .exar1 files under EXAR1_DIR' }, () => {});
} else {
  test('generated cards cover the printed lines', async () => {
    const t0 = performance.now();
    const SQL = await loadSql();
    /** @type {Map<string, Tally>} */ const byCategory = new Map();
    /** @type {Map<string, Tally>} */ const byTab = new Map();
    /** @type {Map<string, Tally>} */ const bySlot = new Map(); // standard/service: `card | label`
    /** @type {Map<string, number>} */ const extra = new Map(); // standard/service: `card | label`
    /** @type {Map<string, number>} */ const extraByCategory = new Map();
    /** @type {Map<string, number>} */ const approximate = new Map();
    /** @type {Map<string, { compared: number, differ: number }>} */ const groups = new Map();
    let joined = 0;
    let unmatchedSteps = 0;
    let unmatchedPrints = 0;
    let omitted = 0;
    /** @type {Map<string, Tally>} */ const headerFields = new Map(); // standard/service: header field, by name
    let unparsedHeaders = 0;

    for (const { exar1, xml } of pairs) {
      const bytes = new Uint8Array(readFileSync(exar1));
      const opened = openDb(SQL, bytes);
      const loaded = await loadExar(opened.db, inflateRaw, { id: exar1, name: basename(exar1), size: bytes.length });
      const print = readPrint(readFileSync(xml, 'utf8'));
      assert.ok(loaded.ok, `cannot read ${basename(exar1)}`);
      assert.ok(print.ok, `cannot read the print of ${basename(exar1)}`);
      const join = joinPrint(loaded.file, print.protocols);
      joined += join.pairs.length;
      unmatchedSteps += join.unmatchedSteps.length;
      unmatchedPrints += join.unmatchedProtocols.length;
      const source = createFileSource(opened, inflateRaw);
      try {
        for (const { step, protocol } of join.pairs) {
          const blob = step.detail.protocolBlob;
          const text = blob ? await source.text(blob) : null;
          if (!blob || !text?.ok) continue;
          const o = observationOf(protocol, cardSources(text.text, await source.summary(blob)));
          const product = (o.category === 'standard' || o.category === 'service') && PREFIXES.some((p) => o.sequence.startsWith(p));
          const category = product ? 'standard/service' : o.category === 'standard' || o.category === 'service' ? 'other' : o.category;
          const built = buildCards(CATALOG, o.src);
          omitted += built.omitted;
          if (built.approximate) bump(approximate, category);
          if (product) {
            const m = protocol.header.lines.map((l) => HEADER.exec(l)).find((x) => x !== null);
            if (!m?.groups) unparsedHeaders++;
            else {
              const [g, h] = [m.groups, built.header];
              const triggered = (o.src.pv.get('sub.0.msr.sig_mode1') ?? '236') !== '236';
              const taOk = g.ta === h.ta;
              tally(headerFields, 'ta', taOk);
              tally(headerFields, triggered ? 'ta (triggered steps)' : 'ta (untriggered steps)', taOk);
              tally(headerFields, 'pm', g.pm === h.pm);
              tally(headerFields, 'pat (shown, and its value)', (g.pat ?? null) === h.pat);
              if (g.voxel !== undefined) tally(headerFields, 'voxel', sameNumbers(g.voxel, h.voxel));
              else tally(headerFields, 'voi', sameNumbers(g.voi, h.voi));
              tally(headerFields, 'snr', g.snr === h.snr);
              tally(headerFields, 'substep', (g.substep ?? null) === h.substep);
            }
          }
          const generated = new Map(built.tabs.flatMap((t) => t.cards.map((c) => [c.name, c.lines])));
          const printedNames = new Set(protocol.cards.map((c) => c.name));

          for (const card of protocol.cards) {
            const made = generated.get(card.name) ?? [];
            const printedKeys = keyed(card.params);
            const madeKeys = keyed(made);
            const madeByKey = new Map(made.map((l, i) => [madeKeys[i].key, l]));
            const tab = card.name.split(' - ')[0];
            card.params.forEach((p, i) => {
              const m = madeByKey.get(printedKeys[i].key);
              const hit = m !== undefined && sameText(m.text, p.value);
              tally(byCategory, category, hit);
              if (product) {
                tally(byTab, tab, hit);
                tally(bySlot, `${card.name} | ${printedKeys[i].label.replace(PREFIX, '')}`, hit);
              }
            });
            const printedSet = new Set(printedKeys.map((k) => k.key));
            made.forEach((l, i) => {
              if (printedSet.has(madeKeys[i].key)) return;
              bump(extraByCategory, category);
              if (product) bump(extra, `${card.name} | ${madeKeys[i].label.replace(PREFIX, '')}`);
            });
            if (product) {
              for (const [kind, header] of Object.entries(HEADERS)) {
                const [a, b] = [blocks(card.params, header), blocks(made, header)];
                if (a === 0 && b === 0) continue;
                const g = groups.get(kind) ?? { compared: 0, differ: 0 };
                g.compared++;
                if (a !== b) g.differ++;
                groups.set(kind, g);
              }
            }
          }
          // Generated cards the print does not have.
          for (const [name, made] of generated) {
            if (printedNames.has(name)) continue;
            extraByCategory.set(category, (extraByCategory.get(category) ?? 0) + made.length);
            if (product) for (const l of made) bump(extra, `${name} | ${l.label.replace(PREFIX, '')}`);
          }
        }
      } finally {
        source.close();
      }
    }

    const sum = (/** @type {Tally[]} */ ts) => ts.reduce((a, t) => ({ lines: a.lines + t.lines, hit: a.hit + t.hit }), { lines: 0, hit: 0 });
    const all = sum([...byCategory.values()]);
    const product = byCategory.get('standard/service') ?? { lines: 0, hit: 0 };
    const out = [
      `print coverage: ${pairs.length} exports, ${joined} joined steps, ${unmatchedSteps} steps and ${unmatchedPrints} prints unmatched`,
      `overall: ${pct(all.hit, all.lines)} of ${all.lines} printed lines`,
      'per category:', ...[...byCategory].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, t]) => `  ${k}: ${pct(t.hit, t.lines)} of ${t.lines}`),
      'per tab (standard/service):', ...[...byTab].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, t]) => `  ${k}: ${pct(t.hit, t.lines)} of ${t.lines}`),
      `top ${TOP} missed (standard/service), by misses:`,
      ...[...bySlot].map(([k, t]) => ({ k, lines: t.lines, miss: t.lines - t.hit })).filter((x) => x.miss > 0)
        .sort((a, b) => b.miss - a.miss || (a.k < b.k ? -1 : 1)).slice(0, TOP).map((x) => `  ${x.k}: ${x.miss} of ${x.lines}`),
      `generated lines with no printed counterpart: ${[...extraByCategory].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`,
      `top ${TOP} extra (standard/service):`,
      ...[...extra].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).slice(0, TOP).map(([k, n]) => `  ${k}: ${n}`),
      `omitted lines (all shown cards): ${omitted}`,
      `approximate (sequence not in the catalog): ${[...approximate].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`,
      'printed cards whose group block count differs from the generated (standard/service):',
      ...[...groups].map(([k, g]) => `  ${k}: ${g.differ} of ${g.compared}`),
      `header fields (standard/service; ${unparsedHeaders} headers not parsed), reported only:`,
      ...[...headerFields].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, t]) => `  ${k}: ${pct(t.hit, t.lines)} of ${t.lines}`),
      `time: ${((performance.now() - t0) / 1000).toFixed(1)} s`,
    ];
    console.log(out.join('\n'));

    assert.ok(joined > 0, 'no printed protocol joined a step');
    assert.ok(product.lines > 0, 'no standard/service line was printed');
    assert.ok(product.hit / product.lines >= MIN_COVERAGE,
      `standard/service coverage ${pct(product.hit, product.lines)} is below ${(100 * MIN_COVERAGE).toFixed(1)}%`);
  });
}

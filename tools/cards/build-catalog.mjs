// @ts-check
/**
 * Builds the card catalog shipped with the app (src/core/cardcatalog.json, schema v1 of
 * src/core/cards.js) from scanner prints: `X.exar1` with a sibling print `X.xml`, anywhere under
 * the directory given. The layout is fitted from all prints, the rules (shapes in rules.json) from
 * the prints of standard and service sequences; cards and slots that only other sequences printed
 * are left out, and predicates are fitted without free-text values, so the catalog holds scanner
 * vocabulary only.
 * Prints a report for privacy review to stdout. Prints are confidential and never committed.
 *
 *   node tools/cards/build-catalog.mjs <dir>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { openDb } from '../../src/platform/sqlite.js';
import { inflateRaw } from '../../src/platform/inflate.js';
import { createFileSource } from '../../src/platform/source.js';
import { loadExar } from '../../src/core/load.js';
import { cardSources, sourceNumber, sourceValue } from '../../src/core/cardsource.js';
import { evaluateRule, parseCatalog } from '../../src/core/cards.js';
import { FORMULAS } from '../../src/core/cardformulas.js';
import { findPrintPairs, readPrint, joinPrint } from './prints.js';
import { fitLayout, observationOf } from './layout.js';
import { applyPolicy, collectInstances, fitRule, policyContext } from './fitrules.js';

const OUT = new URL('../../src/core/cardcatalog.json', import.meta.url);
const RULES = new URL('./rules.json', import.meta.url);
const PREFIXES = ['%SiemensSeq%', '%AdjustSeq%', '%ServiceSeq%'];
/** A code value: a number, hex, a boolean or a missing value (fitrules' code test). */
const CODE = /^(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|0x[0-9a-f]+|true|false|<absent>)$/i;
/** Keys that are a `ParamChoice` in the XProtocol (checked offline): their values are scanner symbols. */
const PARAM_CHOICE_KEYS = [
  'ctrl:MultiStep.ComposingFunction', 'ctrl:MultiStep.ComposingNormalize', 'ctrl:Properties.AutoLoad.GraphicSegmentChoice',
  'ctrl:Properties.AutoLoad.InlinePositionDisplayOrientation', 'ctrl:Properties.Queue.CoilSelectMode', 'ctrl:Properties.Queue.WaitForStartChoice',
  'eva:EVA.BreastFunctor.CombineLUT', 'eva:EVA.BreastFunctor.MIPLUT', 'eva:EVA.BreastFunctor.PEILUT', 'eva:EVA.BreastFunctor.TTPLUT',
  'eva:EVA.BreastFunctor.WashinLUT', 'eva:EVA.BreastFunctor.WashoutLUT', 'eva:EVA.BreastMoCoFunctor.mode', 'eva:EVA.FMRIFunctor.InlineLUT',
  'eva:EVA.FMRIFunctor.window', 'eva:EVA.MIPFactory.axis_radial_views', 'eva:EVA.MotionCorrDecorator.InterpolMoCo', 'eva:EVA.PaslFunctor.ColorLUT',
];

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node tools/cards/build-catalog.mjs <dir with X.exar1 and X.xml prints>');
  process.exit(2);
}
const t0 = performance.now();
/** @type {Record<string, Record<string, import('./fitrules.js').Shape>>} */
const shapes = JSON.parse(readFileSync(RULES, 'utf8'));
const choiceKeys = new Set([...PARAM_CHOICE_KEYS, ...Object.values(shapes).flatMap((c) => Object.values(c).flatMap((s) => (s.kind === 'lookup' ? s.choiceKeys ?? [] : [])))]);
/** Whether a predicate may test for this value of the key. @param {string} key @param {string} v */
const isCode = (key, v) => CODE.test(v) || choiceKeys.has(key);
const lines = /** @type {string[]} */ ([]);
const say = (/** @type {string} */ s) => lines.push(s);
/** Whether a print counts as of a standard or service sequence (and one named with PREFIXES; others count as other). */
const isProduct = (/** @type {{ category: string }} */ o) => o.category === 'standard' || o.category === 'service';

// ---- Observations: each printed protocol joined to its step's sources ----
const SQL = await createRequire(import.meta.url)('../../vendor/sql.js/sql-wasm.js')({
  wasmBinary: readFileSync(new URL('../../vendor/sql.js/sql-wasm.wasm', import.meta.url)),
});
/** @type {import('./layout.js').Observation[]} */
const observations = [];
for (const { exar1, xml } of findPrintPairs(dir)) {
  const bytes = new Uint8Array(readFileSync(exar1));
  const opened = openDb(SQL, bytes);
  const loaded = await loadExar(opened.db, inflateRaw, { id: exar1, name: exar1, size: bytes.length });
  const print = readPrint(readFileSync(xml, 'utf8'));
  if (!loaded.ok || !print.ok) throw new Error(`cannot read ${loaded.ok ? xml : exar1}`);
  const { pairs, unmatchedSteps, unmatchedProtocols } = joinPrint(loaded.file, print.protocols);
  const source = createFileSource(opened, inflateRaw);
  for (const { step, protocol } of pairs) {
    const blob = step.detail.protocolBlob;
    const text = blob ? await source.text(blob) : null;
    if (!blob || !text?.ok) continue;
    // A copy, so the sources hold no slice of the protocol text.
    const o = observationOf(protocol, structuredClone(cardSources(text.text, await source.summary(blob))));
    observations.push(PREFIXES.some((p) => o.sequence.startsWith(p)) || !isProduct(o) ? o : { ...o, category: 'other' });
  }
  source.close();
  say(`${exar1}: ${pairs.length} joined, ${unmatchedSteps.length} steps and ${unmatchedProtocols.length} prints unmatched`);
}
const tLoad = performance.now();

// ---- Layout, without what only other sequences printed ----
// Fitted on sources without free-text values, so that no predicate tests one.
/** @param {string} prefix @param {ReadonlyMap<string, string>} m */
const codesOnly = (prefix, m) => new Map([...m].filter(([k, v]) => isCode(prefix + k, v)));
const fitted = fitLayout(observations.map((o) => ({
  ...o, src: { ...o.src, asc: codesOnly('', o.src.asc), ctrl: codesOnly('ctrl:', o.src.ctrl), eva: codesOnly('eva:', o.src.eva) },
})));
const all = collectInstances(observations, fitted);
const productLines = (/** @type {string} */ card, /** @type {string} */ id) => (all.get(card)?.get(id) ?? []).filter(isProduct);
const slotCount = Object.values(fitted.slots).flat().length;
const productObs = observations.filter(isProduct);
/** @param {import('./layout.js').PredicateJson} p @param {import('../../src/core/cardsource.js').CardSources} src */
const holds = (p, src) => ('in' in p ? p.in.includes(sourceValue(src, p.key) ?? '<absent>')
  : 'nonzero' in p ? (sourceNumber(src, p.key) ?? 0) !== 0 : sourceValue(src, p.key) !== null);
const productCards = new Set(productObs.flatMap((o) => o.cards.map((c) => c.name)));
/** @type {Record<string, import('./layout.js').LayoutSlot[]>} */
const slots = {};
for (const card of fitted.cards) {
  const kept = new Set();
  if (productCards.has(card)) slots[card] = fitted.slots[card].filter((s) => (s.parent === undefined || kept.has(s.parent)) && productLines(card, s.id).length > 0 && kept.add(s.id));
}
const cards = fitted.cards.filter((c) => slots[c]);
/** @type {Record<string, import('./layout.js').LayoutSequence>} */
const sequences = {};
for (const [seq, s] of Object.entries(fitted.sequences)) {
  const narrowed = Object.entries(s.slots ?? {}).map(([card, ids]) => [card, ids.filter((id) => slots[card].some((x) => x.id === id))])
    .filter(([card, ids]) => ids.length < slots[/** @type {string} */ (card)].length);
  sequences[seq] = narrowed.length ? { cards: s.cards, slots: Object.fromEntries(narrowed) } : { cards: s.cards };
}
say(`customer-only: dropped ${fitted.cards.length - cards.length} of ${fitted.cards.length} cards, ${slotCount - Object.values(slots).flat().length} of ${slotCount} slots`);

// Predicates: a guard (none should test free text), and how often each ungrouped `when` errs on
// the standard/service prints that may print its slot, read from the full sources as the app does.
const whenErrors = /** @type {string[]} */ ([]);
for (const card of cards) {
  for (const s of slots[card]) {
    for (const p of [s.when, s.bang]) if (p && 'in' in p && !p.in.every((v) => isCode(p.key, v))) throw new Error(`free-text predicate: ${card} | ${s.id}`);
    const p = s.when;
    if (!p || s.group !== undefined) continue;
    const printedBy = new Set(productLines(card, s.id).map((i) => i.src));
    const wrong = productObs.filter((o) => o.cards.some((c) => c.name === card) && (sequences[o.sequence]?.slots?.[card]?.includes(s.id) ?? true)
      && holds(p, o.src) !== printedBy.has(o.src)).length;
    if (wrong) whenErrors.push(`  ${card} | ${s.id} | ${p.key} | wrong on ${wrong}`);
  }
}

// ---- Rules ----
const instances = collectInstances(observations, { slots });
const unmapped = /** @type {string[]} */ ([]);
const fits = cards.flatMap((card) => slots[card].map((s) => {
  const shape = shapes[card]?.[s.id];
  if (!shape) unmapped.push(`${card} | ${s.id}`);
  return { card, id: s.id, fit: fitRule(shape ?? { kind: 'unknown', why: 'no rule yet' }, instances.get(card)?.get(s.id) ?? []) };
}));
const context = policyContext(fits, Object.keys(sequences));
const ruled = fits.map((f) => ({ ...f, ...applyPolicy(f, context) }));
const tFit = performance.now();

// ---- The catalog: sorted keys, one slot per line ----
/** @param {unknown} v @returns {unknown} */
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(/** @type {Record<string, unknown>} */ (v)[k])])) : v);
const ruleOf = new Map(ruled.map((r) => [`${r.card}\0${r.id}`, r.rule]));
const catalog = {
  version: 1, cards, sequences,
  slots: Object.fromEntries(cards.map((c) => [c, slots[c].map((s) => ({ ...s, rule: ruleOf.get(`${c}\0${s.id}`) }))])),
};
const parsed = parseCatalog(catalog);
if (!parsed.ok) throw new Error(`the catalog does not parse: ${parsed.error}`);
/** @param {Record<string, unknown>} rec @param {(v: unknown) => string} each */
const block = (rec, each) => Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${each(rec[k])}`).join(',\n');
const json = `{"cards":${JSON.stringify(cards)},\n"sequences":{\n${block(sequences, (v) => JSON.stringify(sorted(v)))}},\n`
  + `"slots":{\n${block(catalog.slots, (v) => `[\n${/** @type {unknown[]} */ (v).map((s) => JSON.stringify(sorted(s))).join(',\n')}]`)}},\n"version":1}\n`;
writeFileSync(OUT, json);

// ---- Report ----
const count = (/** @type {string[]} */ xs) => Object.entries(xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), /** @type {Record<string, number>} */ ({})))
  .sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => `  ${n}\t${k}`);
const pct = (/** @type {number} */ a, /** @type {number} */ b) => (b ? `${((100 * a) / b).toFixed(2)}%` : '-');
let [total, text, value, unscored, textScored] = [0, 0, 0, 0, 0];
const accuracy = ruled.map(({ card, id, rule, fit }) => {
  const printed = (instances.get(card)?.get(id) ?? []).filter(isProduct);
  const out = parsed.catalog.slots.get(card)?.find((s) => s.id === id)?.rule;
  const hits = printed.filter((i) => {
    const o = out && evaluateRule(out, i.src, i.group, FORMULAS);
    return o && o !== 'omitted' && o.text === i.text && (o.label === undefined || o.label === i.label);
  }).length;
  total += printed.length;
  text += hits;
  if (fit.accuracy) [value, textScored] = [value + fit.accuracy.value, textScored + hits];
  else unscored += printed.length;
  return `  ${card} | ${id} | ${rule.kind} | ${printed.length} lines | committed text ${pct(hits, printed.length)}`
    + (fit.accuracy ? ` | fitted text ${pct(fit.accuracy.text, fit.accuracy.lines)} value ${pct(fit.accuracy.value, fit.accuracy.lines)}` : ' | formula not registered');
});
const constants = ruled.flatMap(({ card, id, rule }) => (rule.kind === 'constant' ? [`  ${card} | ${id} | ${JSON.stringify(rule.text)}`] : []));
const tables = ruled.flatMap(({ card, id, rule }) => (rule.kind === 'lookup'
  ? [`  ${card} | ${id} | ${rule.keys.join(' + ')}`, ...Object.entries(rule.table).map(([k, v]) => `      ${JSON.stringify(k.split('\u001f'))} -> ${JSON.stringify(v)}`)] : []));
const predicates = cards.flatMap((card) => slots[card].flatMap((s) => [s.when, s.bang].flatMap((p) => (p && 'in' in p && p.in.length
  ? [`  ${card} | ${s.id} | ${p.key} in ${JSON.stringify(p.in)}`] : []))));
const size = Buffer.byteLength(json);
const report = [
  `card catalog: ${observations.length} printed protocols (${productObs.length} of standard/service sequences)`,
  ...lines,
  `wrote ${OUT.pathname}: ${size} bytes, ${cards.length} cards, ${Object.keys(sequences).length} sequences, ${ruled.length} slots`,
  `time: load ${((tLoad - t0) / 1000).toFixed(1)} s, fit ${((tFit - tLoad) / 1000).toFixed(1)} s, total ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  `layout: ${fitted.report.cycles.length} order cycles, ${fitted.report.splitRuns} split runs, ${fitted.report.parentFixes} parent fixes`,
  'slots per rule kind:', ...count(ruled.map((r) => r.rule.kind)),
  'policy outcome per slot:', ...count(ruled.map((r) => r.reason)),
  `in-sample, standard/service lines: committed text ${pct(text, total)} of ${total}; of the ${total - unscored} lines not on`
    + ` formulas still to register: committed text ${pct(textScored, total - unscored)}, fitted (before the policy) value ${pct(value, total - unscored)}`,
  `\nungrouped \`when\` predicates that err on standard/service prints: ${whenErrors.length}`, ...whenErrors,
  `\nunmapped labels (no shape in rules.json): ${unmapped.length}`, ...unmapped.map((u) => `  ${u}`),
  '\ndropped rules (unknown in the catalog):', ...ruled.filter((r) => r.rule.kind === 'unknown').map((r) => `  ${r.card} | ${r.id} | ${r.reason}`),
  '\nper-rule accuracy:', ...accuracy,
  '\nPRIVACY REVIEW: every committed constant:', ...constants,
  '\nPRIVACY REVIEW: every committed lookup table (keys -> text):', ...tables,
  '\nPRIVACY REVIEW: every committed `in` predicate:', ...predicates,
  '\nPRIVACY REVIEW: every sequence name:', ...Object.keys(sequences).sort().map((s) => `  ${s}`),
].join('\n');
console.log(report);

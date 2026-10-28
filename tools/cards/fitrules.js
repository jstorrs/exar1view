// @ts-check
/**
 * Offline fitter of the card catalog's value rules (schema v1 of src/core/cards.js) from scanner
 * prints: a hand-reviewed rule shape per slot (kind and source keys, no printed values) gets its
 * printed parts (units, number formats, lookup tables, formula variants) from the prints of
 * standard and service sequences, then a privacy policy keeps only scanner vocabulary. Pure; a
 * tool, not part of the app.
 */
import { sourceNumber, sourceValue } from '../../src/core/cardsource.js';
import { formatNumber } from '../../src/core/numfmt.js';
import { FORMULAS } from '../../src/core/cardformulas.js';
import { evaluateRule, parseCatalog } from '../../src/core/cards.js';
import { cardLines } from './layout.js';

/** @typedef {import('../../src/core/cardsource.js').CardSources} CardSources */
/** @typedef {import('../../src/core/cardformulas.js').CardFormula} CardFormula */
/** @typedef {import('../../src/core/cards.js').Rule} Rule */
/** @typedef {import('../../src/core/cards.js').Slot} Slot */
/** @typedef {import('../../src/core/seqrefs.js').Category} Category */
/** @typedef {import('./layout.js').Observation} Observation */
/** @typedef {import('./layout.js').Layout} Layout */
/**
 * A slot's rule as `tools/cards/rules.json` holds it: what to read, never what was printed.
 * `choiceKeys`: the `ctrl:`/`eva:` keys of a lookup reviewed as choices, whose values are enum
 * symbols (other XProtocol values may be free text); `variants`: the formula's variants to choose
 * from (global, and per sequence); `review`: a reviewer's note, ignored here.
 * @typedef {({ kind: 'constant' }
 *   | { kind: 'number', key: string, scale: number, offset: number }
 *   | { kind: 'lookup', keys: string[], choiceKeys?: string[] }
 *   | { kind: 'raw', key: string, unit?: string }
 *   | { kind: 'formula', name: string, variants?: string[] }
 *   | { kind: 'unknown', why: string }) & { review?: string }} Shape
 */
/**
 * A rule as catalog JSON (schema v1).
 * @typedef {{ kind: 'constant', text: string }
 *   | { kind: 'number', key: string, scale: number, offset: number, unit: string, format: string, formatBySequence?: Record<string, string>, absent?: number }
 *   | { kind: 'lookup', keys: string[], table: Record<string, string> }
 *   | { kind: 'raw', key: string, unit?: string }
 *   | { kind: 'formula', name: string, variant?: string, variantBySequence?: Record<string, string> }
 *   | { kind: 'unknown', why: string }} RuleJson
 */
/**
 * One printed line of a slot. `group`: the group instance (null outside a group); `label`: the
 * printed label without its `! ` or two-space prefix; `text`: the value as printed; `bang`: as
 * `cardLines` reports it.
 * @typedef {{ sequence: string, category: Category, src: CardSources, group: number | null, label: string, text: string, bang: boolean | null }} Instance
 */
/**
 * A fitted rule. `accuracy`: of the standard/service lines, how many the rule prints exactly
 * (`text`) and by value (`value`: numbers with the same unit compare as numbers); null for a
 * formula not registered yet. `textSequences`: for a constant, how many standard/service sequences
 * printed exactly its text (0 for other rules); `choiceKeys`: the shape's. Counts stay in the
 * tool: only `rule` goes into the catalog.
 * @typedef {{ rule: RuleJson, accuracy: { lines: number, text: number, value: number } | null, textSequences: number, choiceKeys: string[] }} FitResult
 */
/**
 * `sequences`: the full names of the standard and service sequences (`%SiemensSeq%\tse`).
 * @typedef {{ vocabulary: ReadonlySet<string>, varyingFamilies: ReadonlySet<string>, sequences: ReadonlySet<string> }} PolicyContext
 */

const ABSENT = '<absent>';
const SEP = '\u001f';
/** The number formats tried, in tie-break order. */
const FMT_MODES = ['fixed0', 'fixed1', 'fixed2', 'fixed3', 'trim1', 'trim2', 'trim3', 'fixed6'];
const NUMBER_TEXT = /^-?\d+(?:\.\d+)?$/;
/** A printed value that reads as a number. */
const NUMERIC = /^\s*-?\d/;
/** A constant printed by at least this many standard/service sequences is scanner vocabulary. */
const BROAD = 5;
/** A lookup to numbers with more entries than this is a site's settings, not vocabulary. */
const MAX_NUMERIC_TABLE = 8;

const isProduct = (/** @type {{ category: Category }} */ o) => o.category === 'standard' || o.category === 'service';

/**
 * Every printed line of every observation, per card and slot id (the ids of `cardLines` given the
 * layout's slots of the card).
 * @param {Observation[]} observations
 * @param {Pick<Layout, 'slots'>} layout
 * @returns {Map<string, Map<string, Instance[]>>} card -> slot id -> instances
 */
export function collectInstances(observations, layout) {
  /** @type {Map<string, Map<string, Instance[]>>} */
  const out = new Map();
  for (const o of observations) {
    for (const card of o.cards) {
      const ids = out.get(card.name) ?? new Map();
      out.set(card.name, ids);
      for (const l of cardLines(card, layout.slots[card.name] ?? null)) {
        const list = ids.get(l.id) ?? [];
        ids.set(l.id, list);
        const label = l.bang === null ? l.param.label : l.param.label.slice(2);
        list.push({ sequence: o.sequence, category: o.category, src: o.src, group: l.index, label, text: l.param.value, bang: l.bang });
      }
    }
  }
  return out;
}

/** The most common item, the first seen on a tie. @template T @param {Iterable<T>} items @returns {T | undefined} */
function mode(items) {
  /** @type {Map<T, number>} */
  const counts = new Map();
  for (const x of items) counts.set(x, (counts.get(x) ?? 0) + 1);
  /** @type {T | undefined} */
  let best;
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}

/** The value and the unit of a printed text: split at its last space. @param {string} text */
function splitUnit(text) {
  const at = text.lastIndexOf(' ');
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at + 1)];
}

/** Whether two printed texts are equal, or numbers equal by value with the same unit. @param {string} a @param {string} b */
function sameValue(a, b) {
  if (a.trimEnd() === b.trimEnd()) return true;
  const [x, u] = splitUnit(a.trimEnd());
  const [y, v] = splitUnit(b.trimEnd());
  return u === v && x !== '' && y !== '' && !Number.isNaN(parseFloat(x)) && parseFloat(x) === parseFloat(y);
}

const sortedRecord = (/** @type {Map<string, string>} */ m) => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** A formula's output with `variant`; null when it gives none or throws. @param {CardFormula} f @param {Instance} i @param {string | null} variant */
function formulaOut(f, i, variant) {
  try {
    return f(i.src, i.group, variant);
  } catch {
    return null;
  }
}

/** Whether a formula's output is what the instance printed. @param {ReturnType<CardFormula>} out @param {Instance} i */
const formulaHit = (out, i) => (typeof out === 'string' ? out === i.text : out !== null && out.label === i.label && out.text === i.text);

/**
 * The choice (a number format, a formula variant) that prints the most lines, and per sequence the
 * choice that prints more of its lines than the global one does.
 * @param {{ sequence: string, choice: string }[]} hits a line's sequence and a choice that prints it
 */
function choiceBySequence(hits) {
  const global = mode(hits.map((h) => h.choice)) ?? null;
  /** @type {Map<string, string[]>} */
  const per = new Map();
  for (const h of hits) {
    const list = per.get(h.sequence) ?? [];
    per.set(h.sequence, list);
    list.push(h.choice);
  }
  /** @type {Map<string, string>} */
  const bySequence = new Map();
  for (const [seq, choices] of per) {
    const best = /** @type {string} */ (mode(choices));
    const score = (/** @type {string | null} */ c) => choices.filter((x) => x === c).length;
    if (score(best) > score(global)) bySequence.set(seq, best);
  }
  return { global, bySequence };
}

/** A rule as the app reads it, from its JSON. @param {RuleJson} rule @returns {Rule} */
function parsedRule(rule) {
  const parsed = parseCatalog({ version: 1, cards: ['C'], sequences: {}, slots: { C: [{ id: 'x', rule }] } });
  if (!parsed.ok) throw new Error(`fitted rule does not parse: ${parsed.error}`);
  return /** @type {Slot[]} */ (parsed.catalog.slots.get('C'))[0].rule;
}

/**
 * What a rule prints for one instance, as the app does (null: no line).
 * @param {Rule} r @param {Instance} i @param {ReadonlyMap<string, CardFormula>} formulas
 * @returns {string | { label: string, text: string } | null}
 */
function predict(r, i, formulas) {
  const out = evaluateRule(r, i.src, i.group, formulas);
  if (out === null || out === 'omitted') return null;
  return out.label === undefined ? out.text : { label: out.label, text: out.text };
}

/** @param {Extract<Shape, { kind: 'number' }>} shape @param {Instance[]} lines @returns {RuleJson} */
function fitNumber({ key, scale, offset }, lines) {
  /** @type {{ sequence: string, choice: string }[]} */
  const hits = [];
  /** @type {Instance[]} */
  const absentLines = [];
  for (const i of lines) {
    const [a] = splitUnit(i.text);
    const x = sourceNumber(i.src, key, i.group);
    if (x === null) absentLines.push(i);
    const y = x !== null ? x * scale + offset : NUMBER_TEXT.test(a) ? Number(a) : null;
    if (y !== null) for (const m of FMT_MODES) if (formatNumber(y, m) === a) hits.push({ sequence: i.sequence, choice: m });
  }
  const { global, bySequence } = choiceBySequence(hits);
  const format = global ?? 'fixed0';
  /** @type {RuleJson} */
  const rule = { kind: 'number', key, scale, offset, unit: mode(lines.map((i) => splitUnit(i.text)[1])) ?? '', format };
  if (bySequence.size) rule.formatBySequence = sortedRecord(bySequence);
  // A default when the key's absence most often printed a number, stored as the source value x
  // (x * scale + offset is what printed), and kept only when it prints some absent line right.
  const printed = absentLines.map((i) => splitUnit(i.text)[0]);
  const y = mode(printed);
  if (scale !== 0 && y !== undefined && NUMBER_TEXT.test(y)) {
    const x = Number(((Number(y) - offset) / scale).toPrecision(12));
    const fmtOf = (/** @type {Instance} */ i) => bySequence.get(i.sequence) ?? format;
    if (absentLines.some((i, n) => formatNumber(x * scale + offset, fmtOf(i)) === printed[n])) rule.absent = x;
  }
  return rule;
}

/** @param {string[]} keys @param {Instance[]} lines @returns {RuleJson} */
function fitLookup(keys, lines) {
  /** @type {Map<string, string[]>} */
  const byKey = new Map();
  for (const i of lines) {
    const k = keys.map((key) => sourceValue(i.src, key, i.group) ?? ABSENT).join(SEP);
    const texts = byKey.get(k) ?? [];
    byKey.set(k, texts);
    texts.push(i.text);
  }
  const table = new Map([...byKey].map(([k, texts]) => [k, /** @type {string} */ (mode(texts))]));
  return { kind: 'lookup', keys, table: sortedRecord(table) };
}

/** @param {Extract<Shape, { kind: 'formula' }>} shape @param {CardFormula} f @param {Instance[]} lines @returns {RuleJson} */
function fitFormula({ name, variants = [] }, f, lines) {
  if (!variants.length) return { kind: 'formula', name };
  const hits = lines.flatMap((i) => variants.filter((v) => formulaHit(formulaOut(f, i, v), i)).map((v) => ({ sequence: i.sequence, choice: v })));
  const { global, bySequence } = choiceBySequence(hits);
  /** @type {RuleJson} */
  const rule = { kind: 'formula', name };
  if (global !== null) rule.variant = global;
  if (bySequence.size) rule.variantBySequence = sortedRecord(bySequence);
  return rule;
}

/**
 * A slot's rule fitted to its printed lines, from the lines of standard and service sequences only
 * (so no other sequence's name or values reach the rule), with its in-sample accuracy on them.
 * A slot no such sequence printed gets an unknown rule, or for a formula (an `@` slot needs one)
 * the formula as named; a formula not in `formulas` is kept as named, without variants. Neither
 * has an accuracy.
 * @param {Shape} shape
 * @param {Instance[]} instances
 * @param {ReadonlyMap<string, CardFormula>} [formulas]
 * @returns {FitResult}
 */
export function fitRule(shape, instances, formulas = FORMULAS) {
  const lines = instances.filter(isProduct);
  const choiceKeys = shape.kind === 'lookup' ? shape.choiceKeys ?? [] : [];
  /** @param {RuleJson} rule @returns {FitResult} */
  const result = (rule, accuracy = /** @type {FitResult['accuracy']} */ (null)) => {
    const textSequences = rule.kind === 'constant' ? new Set(lines.filter((i) => i.text === rule.text).map((i) => i.sequence)).size : 0;
    return { rule, accuracy, textSequences, choiceKeys };
  };
  const f = shape.kind === 'formula' ? formulas.get(shape.name) : undefined;
  if (shape.kind === 'formula' && (!f || !lines.length)) return result({ kind: 'formula', name: shape.name });
  /** @type {RuleJson} */
  let rule;
  if (!lines.length) rule = { kind: 'unknown', why: 'not printed by a standard or service sequence' };
  else {
    switch (shape.kind) {
      case 'constant': rule = { kind: 'constant', text: /** @type {string} */ (mode(lines.map((i) => i.text))) }; break;
      case 'number': rule = fitNumber(shape, lines); break;
      case 'lookup': rule = fitLookup(shape.keys, lines); break;
      case 'raw': rule = shape.unit === undefined ? { kind: 'raw', key: shape.key } : { kind: 'raw', key: shape.key, unit: shape.unit }; break;
      case 'formula': rule = fitFormula(shape, /** @type {CardFormula} */ (f), lines); break;
      case 'unknown': rule = { kind: 'unknown', why: shape.why }; break;
    }
  }
  const parsed = parsedRule(rule);
  let text = 0;
  let value = 0;
  for (const i of lines) {
    const out = predict(parsed, i, formulas);
    if (out === null) continue;
    if (typeof out === 'string' ? out === i.text : formulaHit(out, i)) text++;
    if (typeof out === 'string' ? sameValue(out, i.text) : formulaHit(out, i)) value++;
  }
  return result(rule, { lines: lines.length, text, value });
}

/** The family of a slot id: its label without `#k`, a group header or a trailing number (`TE 2` is `TE`). @param {string} id */
const familyOf = (id) => id.replace(/#\d+$/, '').replace(/^[^/]*\//, '').replace(/\s*\d+\s*$/, '');

/** A lookup table entry read with some key missing. @param {string} key */
const isAbsentEntry = (key) => key.split(SEP).includes(ABSENT);

/** @param {Extract<RuleJson, { kind: 'lookup' }>} r */
const isNumericLookup = (r) => {
  const outs = Object.values(r.table);
  return outs.length > MAX_NUMERIC_TABLE && outs.filter((o) => NUMERIC.test(o)).length > outs.length / 2;
};

/**
 * The raw rule a one-key lookup is, when every entry prints its own key (with one unit, or none).
 * @param {Extract<RuleJson, { kind: 'lookup' }>} r
 * @returns {Extract<RuleJson, { kind: 'raw' }> | null}
 */
function identityRaw(r) {
  const entries = Object.entries(r.table);
  if (r.keys.length !== 1 || !entries.length || entries.some(([k]) => k === ABSENT)) return null;
  /** @type {Set<string | undefined>} */
  const units = new Set();
  for (const [k, v] of entries) {
    const s = k.replace(/^"+|"+$/g, '');
    if (v === s) units.add(undefined);
    else if (v.startsWith(`${s} `)) units.add(v.slice(s.length + 1));
    else return null;
  }
  if (units.size !== 1) return null;
  const [unit] = units;
  return unit === undefined ? { kind: 'raw', key: r.keys[0] } : { kind: 'raw', key: r.keys[0], unit };
}

/** A source value that is a code, not text: a number, hex, a boolean or a missing value. */
const CODE = /^(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|0x[0-9a-f]+|true|false|<absent>)$/i;
/** An XProtocol enum symbol (a ParamChoice value), as `ctrl:` and `eva:` keys read it unquoted. */
const SYMBOL = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The entries of a lookup the policy may keep, before absent defaults: null when it is no lookup
 * the policy keeps (a numeric table, an identity, or a key that reads only text). An entry is
 * kept when every key value is a code, the name of a standard or service sequence (`seq`,
 * `tSequenceFileName`) or an enum symbol of a reviewed choice key.
 * @param {FitResult} fit @param {ReadonlySet<string>} sequences
 * @returns {{ k: string, v: string }[] | null}
 */
function codeEntries({ rule: r, choiceKeys }, sequences) {
  if (r.kind !== 'lookup' || identityRaw(r) || isNumericLookup(r)) return null;
  const short = new Set([...sequences].map((q) => q.slice(q.lastIndexOf('\\') + 1)));
  /** @param {string} key @param {string} v */
  const isCode = (key, v) => CODE.test(v) || (key === 'seq' && short.has(v))
    || (key === 'tSequenceFileName' && sequences.has(v.replace(/^"+|"+$/g, ''))) || (choiceKeys.includes(key) && SYMBOL.test(v));
  const entries = Object.entries(r.table).map(([k, v]) => ({ k, v, codes: k.split(SEP).map((x, n) => isCode(r.keys[n], x)) }));
  const freeKey = r.keys.some((_, n) => {
    const read = entries.filter((e) => e.k.split(SEP)[n] !== ABSENT);
    return read.length > 0 && read.every((e) => !e.codes[n]);
  });
  return freeKey ? null : entries.filter((e) => e.codes.every(Boolean)).map(({ k, v }) => ({ k, v }));
}

/**
 * What the policy reads across all fitted slots: the vocabulary (the outputs of the lookups it
 * keeps, for keys read in full and all codes, and the texts of constants printed by at least five
 * standard or service sequences) and the label families of the number, formula and lookup rules
 * it keeps.
 * @param {{ id: string, fit: FitResult }[]} fitted
 * @param {Iterable<string>} sequences the full names of the standard and service sequences
 * @returns {PolicyContext}
 */
export function policyContext(fitted, sequences) {
  const seqs = new Set(sequences);
  /** @type {Set<string>} */
  const vocabulary = new Set();
  /** @type {Set<string>} */
  const varyingFamilies = new Set();
  for (const { id, fit } of fitted) {
    const { rule } = fit;
    if (rule.kind === 'constant' && fit.textSequences >= BROAD) vocabulary.add(rule.text);
    if (rule.kind === 'number' || rule.kind === 'formula') varyingFamilies.add(familyOf(id));
    const entries = codeEntries(fit, seqs)?.filter(({ k }) => !isAbsentEntry(k));
    if (entries?.length) {
      varyingFamilies.add(familyOf(id));
      for (const { v } of entries) vocabulary.add(v);
    }
  }
  return { vocabulary, varyingFamilies, sequences: seqs };
}

/**
 * The rule the catalog may hold for a fitted slot, so that only scanner vocabulary is committed,
 * and the reason (fixed phrases, for review; it quotes no printed text):
 *   - a constant is kept when broad (its text printed by at least five standard/service
 *     sequences), else dropped when numeric, else kept when in the vocabulary or its label
 *     family has a kept number, formula or lookup rule;
 *   - a lookup that prints its own key becomes `raw`, and one to numbers with more than eight
 *     entries is dropped; otherwise a lookup on a key that reads only text is dropped, an entry
 *     whose key holds text (see `codeEntries`) is dropped, and so is an entry read with a key
 *     missing whose text is not vocabulary; a lookup left with no entry is dropped;
 *   - every other rule is kept as it is.
 * A dropped rule becomes `{kind: 'unknown', why}` with the reason as `why`.
 * @param {{ id: string, fit: FitResult }} fitted
 * @param {PolicyContext} context
 * @returns {{ rule: RuleJson, reason: string }}
 */
export function applyPolicy({ id, fit }, context) {
  const { rule } = fit;
  /** @param {string} why */
  const drop = (why) => ({ rule: /** @type {RuleJson} */ ({ kind: 'unknown', why }), reason: why });
  switch (rule.kind) {
    case 'constant':
      if (fit.textSequences >= BROAD) return { rule, reason: 'broad constant' };
      if (NUMERIC.test(rule.text)) return drop('narrow numeric constant');
      if (context.vocabulary.has(rule.text)) return { rule, reason: 'constant in vocabulary' };
      if (context.varyingFamilies.has(familyOf(id))) return { rule, reason: 'constant of a varying label family' };
      return drop('narrow text constant');
    case 'lookup': {
      const raw = identityRaw(rule);
      if (raw) return { rule: raw, reason: 'identity lookup as raw' };
      if (isNumericLookup(rule)) return drop(`numeric lookup with more than ${MAX_NUMERIC_TABLE} entries`);
      const codes = codeEntries(fit, context.sequences);
      if (!codes) return drop('lookup on a text key');
      const kept = codes.filter(({ k, v }) => !isAbsentEntry(k) || context.vocabulary.has(v));
      if (!kept.length) return drop('lookup with no entry left');
      const notes = [];
      if (codes.length < Object.keys(rule.table).length) notes.push('without text keys');
      if (kept.length < codes.length) notes.push('without absent defaults outside vocabulary');
      if (!notes.length) return { rule, reason: 'lookup' };
      return { rule: { ...rule, table: Object.fromEntries(kept.map(({ k, v }) => [k, v])) }, reason: `lookup ${notes.join(', ')}` };
    }
    default: return { rule, reason: rule.kind };
  }
}

// @ts-check
/**
 * The scanner's printed protocol cards rebuilt from a card catalog and one protocol's sources. Pure.
 *
 * Catalog JSON, version 1 (fitted offline from scanner prints, shipped with the app); every object
 * holds only the fields named here:
 *   { version: 1,
 *     cards: string[],                      every card name, once, in print order ("Routine", "Contrast - Common")
 *     sequences: { [tSequenceFileName]: { cards: string[], slots?: { [card]: string[] } } },
 *     slots: { [card]: Slot[] } }           every slot of a card, in print order
 * A sequence (full `tSequenceFileName`, e.g. `%SiemensSeq%\tse`) prints the cards it lists; `slots`
 * narrows one of those cards to the slot ids that sequence prints, still in the card's order (a
 * card it leaves out prints all of them).
 *
 * Slot = { id, group?, parent?, when?, bang?, rule }
 *   id      the printed label. `Label#k` is the k-th repeat of a label in a card (printed as
 *           `Label`); `@name` is a slot whose label a formula computes ({label, text}).
 *   group   'slice' | 'slab' | 'navigator' | 'sat' | 'inversion': the slot repeats per group, and
 *           its id is `Header/Label` (printed `Label`) or `Header/#` (the header line, printed
 *           `Header`, usually the `group_number` formula). The slots of one kind form one run in
 *           the card, which prints once per group, in group order.
 *   parent  the id of an earlier slot of the card, in the same group: the slot prints only if that
 *           slot printed earlier in the same group.
 *   when    the slot prints only when this holds.
 *   bang    the label is prefixed `! ` when this holds and two spaces when not (the print's own
 *           spacing for these lines). Other labels print as they are.
 * Predicate = {key, in: string[]} | {key, nonzero: true} | {key, present: true}; in `in`, the value
 *   `<absent>` stands for a missing value.
 * Rule (by `kind`):
 *   constant {text}
 *   number   {key, scale, offset, unit, format, formatBySequence?, absent?}: `x*scale+offset` as
 *            `format` (numfmt), a space and the unit; `absent` is the source value x (before
 *            scale and offset) used when the key is missing.
 *   lookup   {keys, table}: the values of `keys`, joined by U+001F (`<absent>` for a missing one).
 *            A miss prints the values themselves (`a | b`, `—` for a missing one) as a 'raw' line.
 *   raw      {key, unit?}: the source value as it is.
 *   formula  {name, variant?, variantBySequence?}: a function of cardformulas.js.
 *   unknown  {why}: a line no rule reproduces.
 * Source keys are those of cardsource.js; `[#]` and `.#` take the group index.
 */
import { sourceNumber, sourceValue } from './cardsource.js';
import { formatNumber } from './numfmt.js';
import { FORMULAS, header } from './cardformulas.js';
import { FormatError, errorText } from './errors.js';

/** @typedef {import('./cardsource.js').CardSources} CardSources */
/** @typedef {import('./cardformulas.js').CardFormula} CardFormula */
/** @typedef {import('./cardformulas.js').CardHeader} CardHeader */
/** @typedef {'slice' | 'slab' | 'navigator' | 'sat' | 'inversion'} GroupKind */
/** @typedef {{ kind: 'in', key: string, values: ReadonlySet<string> } | { kind: 'nonzero', key: string } | { kind: 'present', key: string }} Predicate */
/**
 * @typedef {{ kind: 'constant', text: string }
 *   | { kind: 'number', key: string, scale: number, offset: number, unit: string, format: string, formatBySequence: ReadonlyMap<string, string>, absent: number | null }
 *   | { kind: 'lookup', keys: string[], table: ReadonlyMap<string, string> }
 *   | { kind: 'raw', key: string, unit: string | null }
 *   | { kind: 'formula', name: string, variant: string | null, variantBySequence: ReadonlyMap<string, string> }
 *   | { kind: 'unknown', why: string }} Rule
 */
/**
 * `label`: the printed label, null for an `@` slot (its formula gives the label).
 * @typedef {{ id: string, label: string | null, group: GroupKind | null, parent: string | null, when: Predicate | null, bang: Predicate | null, rule: Rule }} Slot
 */
/** @typedef {{ cards: string[], slots: ReadonlyMap<string, ReadonlySet<string>> }} SequenceCards */
/** @typedef {{ cards: string[], sequences: ReadonlyMap<string, SequenceCards>, slots: ReadonlyMap<string, Slot[]> }} Catalog */
/** @typedef {{ label: string, text: string, status: 'ok' | 'raw' }} CardLine */
/** @typedef {{ tabs: { tab: string, cards: { name: string, lines: CardLine[] }[] }[], omitted: number, approximate: boolean, header: CardHeader }} Cards */

const ABSENT = '<absent>';
const SEP = '\u001f';
/** @type {Record<GroupKind, string>} the array whose size is the number of groups */
const GROUP_ARRAY = { slice: 'sGroupArray', slab: 'sGroupArray', navigator: 'sNavigatorArray', sat: 'sRSatArray', inversion: 'sInversionArray' };
const MAX_GROUPS = 128;
/** @type {Record<string, string[]>} the fields of each rule kind */
const RULE_FIELDS = {
  constant: ['text'], number: ['key', 'scale', 'offset', 'unit', 'format', 'formatBySequence', 'absent'],
  lookup: ['keys', 'table'], raw: ['key', 'unit'], formula: ['name', 'variant', 'variantBySequence'], unknown: ['why'],
};

/** @param {string} path @param {string} msg @returns {never} */
function fail(path, msg) {
  throw new FormatError(`${path}: ${msg}`);
}

/**
 * An object; with `fields`, one holding no other field.
 * @param {unknown} v @param {string} path @param {string[]} [fields] @returns {Record<string, unknown>}
 */
function obj(v, path, fields) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(path, 'expected an object');
  const extra = fields && Object.keys(v).find((k) => !fields.includes(k));
  return extra === undefined ? /** @type {Record<string, unknown>} */ (v) : fail(path, `unknown field ${JSON.stringify(extra)}`);
}

/** @param {unknown} v @param {string} path */
function str(v, path) {
  return typeof v === 'string' ? v : fail(path, 'expected a string');
}

/** @param {unknown} v @param {string} path */
function num(v, path) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fail(path, 'expected a number');
}

/** @param {unknown} v @param {string} path */
function strs(v, path) {
  return Array.isArray(v) ? v.map((x, i) => str(x, `${path}[${i}]`)) : fail(path, 'expected an array');
}

/** An object's entries parsed by `f`, as a Map. @template T @param {unknown} v @param {string} path @param {(x: unknown, path: string) => T} f */
function record(v, path, f) {
  return new Map(Object.entries(obj(v, path)).map(([k, x]) => [k, f(x, `${path}[${JSON.stringify(k)}]`)]));
}

/** @param {unknown} v @param {string} path */
function format(v, path) {
  const f = str(v, path);
  return formatNumber(0, f) === null ? fail(path, `unknown number format ${JSON.stringify(f)}`) : f;
}

/** @param {unknown} v @param {string} path @returns {Predicate | null} */
function predicate(v, path) {
  if (v === undefined) return null;
  const o = obj(v, path, ['key', 'in', 'nonzero', 'present']);
  const key = str(o.key, `${path}.key`);
  const tests = Object.keys(o).filter((k) => k !== 'key');
  if (tests.length !== 1) fail(path, 'expected exactly one of "in", "nonzero", "present"');
  if (tests[0] === 'in') return { kind: 'in', key, values: new Set(strs(o.in, `${path}.in`)) };
  if (o[tests[0]] !== true) fail(`${path}.${tests[0]}`, 'expected true');
  return tests[0] === 'nonzero' ? { kind: 'nonzero', key } : { kind: 'present', key };
}

/** @param {unknown} v @param {string} path @returns {Rule} */
function rule(v, path) {
  const kind = obj(v, path).kind;
  if (typeof kind !== 'string' || !Object.hasOwn(RULE_FIELDS, kind)) fail(`${path}.kind`, `unknown rule kind ${JSON.stringify(kind)}`);
  const o = obj(v, path, ['kind', ...RULE_FIELDS[kind]]);
  /** An optional field. @template T, D @param {string} k @param {(x: unknown, p: string) => T} f @param {D} dflt @returns {T | D} */
  const opt = (k, f, dflt) => (o[k] === undefined ? dflt : f(o[k], `${path}.${k}`));
  switch (kind) {
    case 'constant': return { kind, text: str(o.text, `${path}.text`) };
    case 'number': return {
      kind, key: str(o.key, `${path}.key`), scale: num(o.scale, `${path}.scale`), offset: num(o.offset, `${path}.offset`),
      unit: str(o.unit, `${path}.unit`), format: format(o.format, `${path}.format`),
      formatBySequence: opt('formatBySequence', (x, p) => record(x, p, format), new Map()), absent: opt('absent', num, null),
    };
    case 'lookup': {
      const keys = strs(o.keys, `${path}.keys`);
      return keys.length ? { kind, keys, table: record(o.table, `${path}.table`, str) } : fail(`${path}.keys`, 'expected at least one key');
    }
    case 'raw': return { kind, key: str(o.key, `${path}.key`), unit: opt('unit', str, null) };
    case 'formula': return {
      kind, name: str(o.name, `${path}.name`), variant: opt('variant', str, null),
      variantBySequence: opt('variantBySequence', (x, p) => record(x, p, str), new Map()),
    };
    default: return { kind: 'unknown', why: str(o.why, `${path}.why`) };
  }
}

/**
 * @param {unknown} v @param {string} path
 * @param {Map<string, GroupKind | null>} earlier the card's slots so far, id to group
 * @returns {Slot}
 */
function slot(v, path, earlier) {
  const o = obj(v, path, ['id', 'group', 'parent', 'when', 'bang', 'rule']);
  const id = str(o.id, `${path}.id`);
  if (earlier.has(id)) fail(`${path}.id`, `duplicate id ${JSON.stringify(id)}`);
  const g = o.group === undefined ? null : str(o.group, `${path}.group`);
  if (g !== null && !Object.hasOwn(GROUP_ARRAY, g)) fail(`${path}.group`, `unknown group ${JSON.stringify(g)}`);
  const group = /** @type {GroupKind | null} */ (g);
  const parent = o.parent === undefined ? null : str(o.parent, `${path}.parent`);
  if (parent !== null && !earlier.has(parent)) fail(`${path}.parent`, `no earlier slot ${JSON.stringify(parent)}`);
  if (parent !== null && earlier.get(parent) !== group) fail(`${path}.parent`, `${JSON.stringify(parent)} is in another group`);
  const r = rule(o.rule, `${path}.rule`);
  /** @type {string | null} */
  let label = null;
  if (id.startsWith('@')) {
    if (r.kind !== 'formula') fail(`${path}.rule`, 'an @ slot needs a formula');
  } else {
    label = id.replace(/#\d+$/, '');
    if (group !== null) {
      const at = label.indexOf('/');
      if (at < 0) fail(`${path}.id`, 'a grouped id needs "Header/Label"');
      label = label.slice(at + 1) === '#' ? label.slice(0, at) : label.slice(at + 1);
    }
  }
  earlier.set(id, group);
  return { id, label, group, parent, when: predicate(o.when, `${path}.when`), bang: predicate(o.bang, `${path}.bang`), rule: r };
}

/** A card's slots; each group kind forms one run. @param {unknown} v @param {string} path */
function cardSlots(v, path) {
  if (!Array.isArray(v)) return fail(path, 'expected an array');
  /** @type {Map<string, GroupKind | null>} */
  const earlier = new Map();
  /** @type {Set<GroupKind>} */
  const ended = new Set();
  /** @type {GroupKind | null} */
  let prev = null;
  return v.map((x, i) => {
    const s = slot(x, `${path}[${i}]`, earlier);
    if (prev !== null && prev !== s.group) ended.add(prev);
    if (s.group !== null && ended.has(s.group)) fail(`${path}[${i}].group`, `the run of group ${JSON.stringify(s.group)} already ended`);
    prev = s.group;
    return s;
  });
}

/**
 * The catalog from its JSON value; an error names the path of the first bad part.
 * @param {unknown} json
 * @returns {{ ok: true, catalog: Catalog } | { ok: false, error: string }}
 */
export function parseCatalog(json) {
  try {
    const top = obj(json, 'catalog', ['version', 'cards', 'sequences', 'slots']);
    if (top.version !== 1) fail('catalog.version', 'expected 1');
    const cards = strs(top.cards, 'catalog.cards');
    const known = new Set();
    cards.forEach((c, i) => (known.has(c) ? fail(`catalog.cards[${i}]`, `duplicate card ${JSON.stringify(c)}`) : known.add(c)));
    /** @param {Set<string>} names @param {string} name @param {string} path */
    const card = (names, name, path) => (names.has(name) ? name : fail(path, `unknown card ${JSON.stringify(name)}`));
    const slots = record(top.slots, 'catalog.slots', cardSlots);
    for (const name of slots.keys()) card(known, name, `catalog.slots[${JSON.stringify(name)}]`);
    const sequences = record(top.sequences, 'catalog.sequences', (v, path) => {
      const o = obj(v, path, ['cards', 'slots']);
      const seqCards = strs(o.cards, `${path}.cards`).map((c, i) => card(known, c, `${path}.cards[${i}]`));
      const listed = new Set(seqCards);
      const only = o.slots === undefined ? new Map() : record(o.slots, `${path}.slots`, (x, p) => new Set(strs(x, p)));
      for (const [name, ids] of only) {
        const p = `${path}.slots[${JSON.stringify(name)}]`;
        card(listed, name, p);
        const have = new Set((slots.get(name) ?? []).map((s) => s.id));
        for (const id of ids) if (!have.has(id)) fail(p, `unknown slot ${JSON.stringify(id)}`);
      }
      return { cards: seqCards, slots: only };
    });
    return { ok: true, catalog: { cards, sequences, slots } };
  } catch (e) {
    if (e instanceof FormatError) return { ok: false, error: errorText(e) };
    throw e;
  }
}

/** @param {GroupKind} kind @param {CardSources} src */
function groupCount(kind, src) {
  const n = sourceNumber(src, `${GROUP_ARRAY[kind]}.lSize`) ?? (kind === 'slice' || kind === 'slab' ? 1 : 0);
  return Math.max(0, Math.min(MAX_GROUPS, Math.trunc(n)));
}

/** Whether `key` names a value the protocol stores (not the sequence name or a count of blocks). @param {string} key */
const isStoredKey = (key) => key !== 'seq' && !key.startsWith('meta:');

/** @param {Predicate} p @param {CardSources} src @param {number | null} group */
function holds(p, src, group) {
  switch (p.kind) {
    case 'in': return p.values.has(sourceValue(src, p.key, group) ?? ABSENT);
    case 'nonzero': return (sourceNumber(src, p.key, group) ?? 0) !== 0;
    case 'present': return sourceValue(src, p.key, group) !== null;
  }
}

const unquote = (/** @type {string} */ s) => s.replace(/^"+|"+$/g, '');

/**
 * A rule's line; null when it does not apply, 'omitted' when it cannot be computed. `stored`: the
 * text came from a value the protocol stores (not a constant, a default or a formula). Exported
 * for the offline rule fitter (tools/cards/fitrules.js).
 * @param {Rule} r @param {CardSources} src @param {number | null} group @param {ReadonlyMap<string, CardFormula>} formulas
 * @returns {{ text: string, status: 'ok' | 'raw', stored: boolean, label?: string } | null | 'omitted'}
 */
export function evaluateRule(r, src, group, formulas) {
  switch (r.kind) {
    case 'constant': return { text: r.text, status: 'ok', stored: false };
    case 'number': {
      const read = sourceNumber(src, r.key, group);
      const x = read ?? r.absent;
      const s = x === null ? null : formatNumber(x * r.scale + r.offset, r.formatBySequence.get(src.sequence) ?? r.format);
      return s === null ? null : { text: `${s} ${r.unit}`, status: 'ok', stored: read !== null && isStoredKey(r.key) };
    }
    case 'lookup': {
      const vals = r.keys.map((k) => sourceValue(src, k, group));
      const stored = r.keys.some((k, i) => isStoredKey(k) && vals[i] !== null);
      const hit = r.table.get(vals.map((v) => v ?? ABSENT).join(SEP));
      if (hit !== undefined) return { text: hit, status: 'ok', stored };
      if (!stored) return null;
      return { text: vals.map((v) => (v === null ? '—' : unquote(v))).join(' | '), status: 'raw', stored };
    }
    case 'raw': {
      const v = sourceValue(src, r.key, group);
      if (v === null) return null;
      return { text: r.unit === null ? unquote(v) : `${unquote(v)} ${r.unit}`, status: 'ok', stored: isStoredKey(r.key) };
    }
    case 'formula': {
      const f = formulas.get(r.name);
      if (!f) return 'omitted';
      /** @type {ReturnType<CardFormula>} */
      let out;
      try {
        out = f(src, group, r.variantBySequence.get(src.sequence) ?? r.variant);
      } catch {
        return 'omitted';
      }
      if (typeof out === 'string') return { text: out, status: 'ok', stored: false };
      if (out && typeof out.label === 'string' && typeof out.text === 'string') return { label: out.label, text: out.text, status: 'ok', stored: false };
      return out === null ? null : 'omitted';
    }
    case 'unknown': return 'omitted';
  }
}

/**
 * One protocol's cards. A sequence the catalog does not know gives an `approximate` result that
 * shows only the cards with a line from a value the protocol stores (a rule that read one, or a
 * `when` that held on one). `omitted` counts the lines of the shown cards that should print but
 * have no value: unknown rules, missing formulas, and values missing from the sources. Never throws.
 * @param {Catalog} catalog
 * @param {CardSources} src
 * @param {ReadonlyMap<string, CardFormula>} [formulas]
 * @returns {Cards}
 */
export function buildCards(catalog, src, formulas = FORMULAS) {
  const seq = catalog.sequences.get(src.sequence);
  const shownCards = seq ? new Set(seq.cards) : null;
  let omitted = 0;
  /** @type {Cards['tabs']} */
  const tabs = [];
  for (const name of catalog.cards) {
    if (shownCards && !shownCards.has(name)) continue;
    const only = seq?.slots.get(name);
    const slots = (catalog.slots.get(name) ?? []).filter((s) => !only || only.has(s.id));
    /** @type {CardLine[]} */
    const lines = [];
    const printed = new Set();
    let missing = 0;
    let stored = false;
    /** @param {Slot} s @param {number | null} g */
    const emit = (s, g) => {
      if (s.parent !== null && !printed.has(`${g}${SEP}${s.parent}`)) return;
      if (s.when && !holds(s.when, src, g)) return;
      const out = evaluateRule(s.rule, src, g, formulas);
      if (out === null) { // not applicable under `when` or for an @ slot; otherwise a value the sources lack
        if (!s.when && s.label !== null) missing++;
        return;
      }
      const label = out === 'omitted' ? null : (out.label ?? s.label);
      if (out === 'omitted' || label === null) { // an @ formula that gave no label
        missing++;
        return;
      }
      const prefix = s.bang ? (holds(s.bang, src, g) ? '! ' : '  ') : '';
      lines.push({ label: prefix + label, text: out.text, status: out.status });
      printed.add(`${g}${SEP}${s.id}`);
      stored ||= out.stored || (s.when !== null && isStoredKey(s.when.key) && sourceValue(src, s.when.key, g) !== null);
    };
    for (let i = 0; i < slots.length;) {
      const kind = slots[i].group;
      let j = i + 1;
      while (kind !== null && j < slots.length && slots[j].group === kind) j++;
      const n = kind === null ? 1 : groupCount(kind, src);
      for (let g = 0; g < n; g++) for (const s of slots.slice(i, j)) emit(s, kind === null ? null : g);
      i = j;
    }
    if (!shownCards && !stored) continue;
    omitted += missing;
    const tab = name.split(' - ')[0];
    const known = tabs.find((t) => t.tab === tab);
    if (known) known.cards.push({ name, lines });
    else tabs.push({ tab, cards: [{ name, lines }] });
  }
  const showPat = tabs.some((t) => t.cards.some((c) => c.name === 'Resolution - iPAT'));
  return { tabs, omitted, approximate: !seq, header: header(src, showPat) };
}

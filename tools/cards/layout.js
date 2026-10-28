// @ts-check
/**
 * Offline fitter of the card catalog's layout (schema v1 of src/core/cards.js, without the rules)
 * from scanner prints joined to their protocols: the global card order, each card's slots in print
 * order, the cards and slots of each standard or service sequence, and the `when`/`bang`
 * predicates of slots that print only sometimes. Pure; a tool, not part of the app.
 */
import { categoryOf } from '../../src/core/seqrefs.js';
import { sourceNumber } from '../../src/core/cardsource.js';

/** @typedef {import('../../src/core/cardsource.js').CardSources} CardSources */
/** @typedef {import('../../src/core/seqrefs.js').Category} Category */
/** @typedef {import('../../src/core/cards.js').GroupKind} GroupKind */
/** @typedef {import('./prints.js').PrintCard} PrintCard */
/** @typedef {import('./prints.js').PrintParam} PrintParam */
/** @typedef {import('./prints.js').PrintProtocol} PrintProtocol */

/**
 * One printed protocol with its sources. `sequence`: the full `tSequenceFileName`
 * (`%SiemensSeq%\tse`); `category`: that of its `%Name%` placeholder.
 * @typedef {{ sequence: string, category: Category, src: CardSources, cards: PrintCard[] }} Observation
 */
/** @typedef {{ key: string, in: string[] } | { key: string, nonzero: true } | { key: string, present: true }} PredicateJson */
/** @typedef {{ id: string, group?: GroupKind, parent?: string, when?: PredicateJson, bang?: PredicateJson }} LayoutSlot */
/** @typedef {{ cards: string[], slots?: Record<string, string[]> }} LayoutSequence */
/** @typedef {{ cards: string[], sequences: Record<string, LayoutSequence>, slots: Record<string, LayoutSlot[]> }} Layout */
/**
 * `cycles`: each merge (the card order, `<card>` or `<card>/<group>`) whose prints disagreed, and
 * how many nodes were placed against an edge; `splitRuns`: card prints whose group lines did not
 * form one run; `parentFixes`: children moved after their parent or detached from it.
 * @typedef {{ cycles: { scope: string, broken: number }[], splitRuns: number, parentFixes: number }} LayoutReport
 */
/**
 * A printed line as a slot. `index`: the group instance (null outside a group); `bang`: whether
 * the label had a `! ` (true) or two-space (false) prefix, null for neither; `parent`: for a child
 * line, the id of the line before it.
 * @typedef {{ id: string, group: GroupKind | null, index: number | null, bang: boolean | null, parent: string | null, param: PrintParam }} PrintedSlot
 */

/** @type {Record<string, GroupKind>} */
const HEADERS = { 'Slice group': 'slice', 'Slab group': 'slab', Navigator: 'navigator', 'Sat. region': 'sat', 'Graph. Sel. Inversion': 'inversion' };
/** Labels printed under the line before them (a filter's own option, printed when it is on). */
const CHILD_LABELS = new Set(['Unfiltered images']);
const PREFIX = /^(! |  )(?=\S)/;
/** @type {Record<string, string>} */
const AA_AXIS = { L: 'x', R: 'x', A: 'y', P: 'y', F: 'z', H: 'z' };
/** The Adjust Volume extent lines in print order (their labels are the direction texts of each axis). */
const ADJ_EXTENTS = ['phase', 'read', 'slice'];
const ABSENT = '<absent>';
/** At most this many distinct values for an `in` predicate. */
const MAX_IN = 32;
/** Always false, always true: the `bang` of a label that always prints two spaces or always `! `. */
const NEVER = /** @type {PredicateJson} */ ({ key: 'seq', in: [] });
const ALWAYS = /** @type {PredicateJson} */ ({ key: 'seq', present: true });

/**
 * The slot id of one printed line. The contract shared by the layout and rule fitters and the
 * coverage check; `cardLines` applies it to a whole card.
 *   - A `! ` or two-space prefix is dropped and reported as `bang` (true for `!`); the slot gets a
 *     `bang` predicate.
 *   - `header` is the group header the line belongs to (a header line passes its own label, with
 *     `grouped` false; a grouped line the header line before it), null outside a group. Header
 *     lines are `Header/#`, grouped lines `Header/Label`, both with the header's group kind.
 *   - Outside groups, labels that are data become formula slots: on an AutoAlign card the sign
 *     letters L/R, A/P, F/H are `@aa.x`, `@aa.y`, `@aa.z`, `T > C`-style lines `@aa.angle2` and
 *     `> S`-style lines `@aa.angle3`; on an Adjust Volume card the `R >> L`-style direction
 *     texts are extents by position, whatever their axis: `@adj.phase`, `@adj.read`, `@adj.slice`.
 *   - `k` is how many lines with the same id (at k = 0) came before in the card (in the group
 *     instance, for a grouped line); k > 0 appends `#k`. For an Adjust Volume direction line (id
 *     `@adj.phase` at k = 0) k is its position instead: 1 is `@adj.read`, 2 `@adj.slice`, and a
 *     line beyond the third `@adj.slice#(k - 2)`.
 * Back from a slot: the line prints the slot's label (`Label` of `Label#k` or `Header/Label`; the
 * header for `Header/#`; a formula's label for `@`), with the `bang` prefix if the slot has one,
 * in group instance `index`. Child lines (`Unfiltered images`) are not numbered by `k`: their slot
 * is the one with that label whose `parent` is the line before (see `cardLines`).
 * @param {string} card
 * @param {string} label as printed
 * @param {number} k
 * @param {boolean} grouped the print's GroupId flag
 * @param {string | null} header
 * @returns {{ id: string, group: GroupKind | null, bang: boolean | null }}
 */
export function slotOf(card, label, k, grouped, header) {
  const m = PREFIX.exec(label);
  const bang = m ? m[1] === '! ' : null;
  const text = m ? label.slice(2) : label;
  const group = header !== null && Object.hasOwn(HEADERS, header) ? HEADERS[header] : null;
  let id = text;
  if (group !== null) id = grouped ? `${header}/${text}` : `${header}/#`;
  else if (card.includes('AutoAlign') && Object.hasOwn(AA_AXIS, text)) id = `@aa.${AA_AXIS[text]}`;
  else if (card.includes('AutoAlign') && /^[TCS] > [TCS]$/.test(text)) id = '@aa.angle2';
  else if (card.includes('AutoAlign') && /^> [TCS]$/.test(text)) id = '@aa.angle3';
  else if (card.includes('Adjust Volume')) {
    if (/^[RLAPFH] >> [RLAPFH]$/.test(text)) {
      const at = Math.min(k, ADJ_EXTENTS.length - 1);
      return { id: `@adj.${ADJ_EXTENTS[at]}${k > at ? `#${k - at}` : ''}`, group, bang };
    }
  }
  return { id: k > 0 ? `${id}#${k}` : id, group, bang };
}

/**
 * The slots of a printed card's lines, in print order. A header label followed by a grouped line
 * opens a group instance; grouped lines without one are read as plain lines. A child line
 * (`Unfiltered images`, not first in the card) gets `parent`, the id of the line before it, and
 * the id of the layout slot with its label and that parent when `slots` (the card's layout slots)
 * are given; without them, or with no such slot, its id is the label's own.
 * @param {PrintCard} card
 * @param {LayoutSlot[] | null} [slots]
 * @returns {PrintedSlot[]}
 */
export function cardLines(card, slots = null) {
  /** @type {PrintedSlot[]} */
  const out = [];
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {Map<string, number>} */
  let inGroup = new Map();
  /** @type {Map<string, number>} */
  const instances = new Map();
  /** @type {string | null} */
  let header = null;
  card.params.forEach((param, i) => {
    /** @type {string | null} */
    let h = null;
    /** @type {number | null} */
    let index = null;
    if (!param.grouped) {
      header = Object.hasOwn(HEADERS, param.label) && card.params[i + 1]?.grouped ? param.label : null;
      if (header !== null) {
        index = instances.get(header) ?? 0;
        instances.set(header, index + 1);
        inGroup = new Map();
        h = header;
      }
    } else if (header !== null) {
      h = header;
      index = (instances.get(header) ?? 1) - 1;
    }
    const grouped = param.grouped && h !== null;
    const base = slotOf(card.name, param.label, 0, grouped, h);
    const prev = out.at(-1);
    const text = param.label.replace(PREFIX, '');
    if (CHILD_LABELS.has(text) && prev && prev.group === base.group && prev.index === index) {
      const label = base.id;
      const match = slots?.find((s) => s.parent === prev.id && s.id.replace(/#\d+$/, '') === label);
      out.push({ ...base, id: match ? match.id : label, index, parent: prev.id, param });
      return;
    }
    const counter = grouped ? inGroup : seen;
    const k = h !== null && !grouped ? 0 : counter.get(base.id) ?? 0; // a header line is one per instance
    counter.set(base.id, k + 1);
    out.push({ ...slotOf(card.name, param.label, k, grouped, h), index, parent: null, param });
  });
  return out;
}

/**
 * An observation from a joined print protocol and the sources of its step's protocol.
 * @param {PrintProtocol} protocol
 * @param {CardSources} src
 * @returns {Observation}
 */
export function observationOf(protocol, src) {
  const placeholder = /^%(\w+)%/.exec(src.sequence)?.[1] ?? null;
  return { sequence: src.sequence, category: categoryOf(placeholder), src, cards: protocol.cards };
}

/**
 * One order consistent with every sequence (each a subsequence of it), ties broken by earliest
 * position in any sequence, then first appearance. On a cycle the waiting node with the earliest
 * position is placed anyway; `broken` counts those placements.
 * @param {Iterable<string[]>} sequences
 * @returns {{ order: string[], broken: number }}
 */
export function mergeOrder(sequences) {
  /** @type {Map<string, Set<string>>} */
  const succ = new Map();
  /** @type {Map<string, number>} position: earliest index, then first appearance */
  const firstPos = new Map();
  /** @type {Map<string, number>} */
  const seenAt = new Map();
  for (const s of sequences) {
    s.forEach((x, i) => {
      if (!seenAt.has(x)) seenAt.set(x, seenAt.size);
      firstPos.set(x, Math.min(firstPos.get(x) ?? Infinity, i));
      if (!succ.has(x)) succ.set(x, new Set());
      if (i > 0) /** @type {Set<string>} */ (succ.get(s[i - 1])).add(x);
    });
  }
  /** @type {Map<string, number>} */
  const indeg = new Map([...succ.keys()].map((x) => [x, 0]));
  for (const bs of succ.values()) for (const b of bs) indeg.set(b, /** @type {number} */ (indeg.get(b)) + 1);
  /** @param {string} a @param {string} b */
  const before = (a, b) => /** @type {number} */ (firstPos.get(a)) - /** @type {number} */ (firstPos.get(b))
    || /** @type {number} */ (seenAt.get(a)) - /** @type {number} */ (seenAt.get(b));
  const waiting = new Set(succ.keys());
  /** @type {string[]} */
  const order = [];
  let broken = 0;
  while (waiting.size) {
    let next = null;
    for (const x of waiting) if (indeg.get(x) === 0 && (next === null || before(x, next) < 0)) next = x;
    if (next === null) {
      broken++;
      for (const x of waiting) if (next === null || before(x, next) < 0) next = x;
    }
    const x = /** @type {string} */ (next);
    waiting.delete(x);
    order.push(x);
    for (const b of /** @type {Set<string>} */ (succ.get(x))) indeg.set(b, /** @type {number} */ (indeg.get(b)) - 1);
  }
  return { order, broken };
}

/** Distinct sequences. @param {string[][]} seqs */
const distinct = (seqs) => [...new Map(seqs.map((s) => [s.join('\u0000'), s])).values()];

const isProduct = (/** @type {Observation} */ o) => o.category === 'standard' || o.category === 'service';

/**
 * A fitting key: the slot id, or for a child line the id and its parent's (child slots are
 * numbered once the card's order is known).
 * @param {PrintedSlot} l
 */
const fitKey = (l) => (l.parent === null ? l.id : `${l.id}\u0001${l.parent}`);

/**
 * The slots of one card, in an order consistent with its prints: each group kind's slots merged
 * on their own and placed as one run. Keys are fit keys; `parent` a fit key.
 * @param {string} name
 * @param {PrintedSlot[][]} prints
 * @param {LayoutReport} report
 * @returns {{ key: string, group: GroupKind | null, parent: string | null }[]}
 */
function cardOrder(name, prints, report) {
  /** @type {string[][]} */
  const top = [];
  /** @type {Map<GroupKind, string[][]>} */
  const inGroups = new Map();
  /** @type {Map<string, { group: GroupKind | null, parent: string | null }>} */
  const info = new Map();
  for (const lines of prints) {
    /** @type {string[]} */
    const seq = [];
    /** @type {Map<string, string[]>} */
    const inst = new Map();
    let split = false;
    for (const l of lines) {
      const key = fitKey(l);
      if (!info.has(key)) info.set(key, { group: l.group, parent: l.parent });
      if (l.group === null) {
        seq.push(key);
        continue;
      }
      const marker = `\u0000${l.group}`;
      if (!seq.includes(marker)) seq.push(marker);
      else if (seq.at(-1) !== marker) split = true;
      const at = `${l.group}\u0000${l.index}`;
      const run = inst.get(at) ?? [];
      run.push(key);
      inst.set(at, run);
    }
    if (split) report.splitRuns++;
    top.push(seq);
    for (const [at, run] of inst) {
      const kind = /** @type {GroupKind} */ (at.slice(0, at.indexOf('\u0000')));
      const runs = inGroups.get(kind) ?? [];
      runs.push(run);
      inGroups.set(kind, runs);
    }
  }
  /** @param {string} scope @param {string[][]} seqs */
  const merged = (scope, seqs) => {
    const { order, broken } = mergeOrder(distinct(seqs));
    if (broken) report.cycles.push({ scope, broken });
    return order;
  };
  const keys = merged(name, top).flatMap((k) => (k.startsWith('\u0000')
    ? merged(`${name}/${k.slice(1)}`, /** @type {string[][]} */ (inGroups.get(/** @type {GroupKind} */ (k.slice(1)))))
    : [k]));
  // A child follows its parent, in the parent's group.
  for (const key of [...keys]) {
    const { group, parent } = /** @type {{ group: GroupKind | null, parent: string | null }} */ (info.get(key));
    if (parent === null) continue;
    if (!info.has(parent) || info.get(parent)?.group !== group) {
      info.set(key, { group, parent: null });
      report.parentFixes++;
      continue;
    }
    const at = keys.indexOf(key);
    const p = keys.indexOf(parent);
    if (p > at) {
      keys.splice(at, 1);
      keys.splice(p, 0, key);
      report.parentFixes++;
    }
  }
  return keys.map((key) => ({ key, ...(/** @type {{ group: GroupKind | null, parent: string | null }} */ (info.get(key))) }));
}

/** Child fit keys to slot ids: `Label`, `Label#1`, … in card order, skipping ids in use. @param {string[]} keys */
function childIds(keys) {
  const used = new Set(keys.filter((k) => !k.includes('\u0001')));
  /** @type {Map<string, string>} */
  const ids = new Map();
  for (const k of keys) {
    if (!k.includes('\u0001')) continue;
    const label = k.slice(0, k.indexOf('\u0001'));
    let id = label;
    for (let n = 1; used.has(id); n++) id = `${label}#${n}`;
    used.add(id);
    ids.set(k, id);
  }
  return ids;
}

/** The most common of some sets of names, as a list. @param {string[][]} sets */
function modeSet(sets) {
  /** @type {Map<string, { set: string[], n: number }>} */
  const counts = new Map();
  for (const s of sets) {
    const k = [...s].sort().join('\u0000');
    const c = counts.get(k) ?? { set: s, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  let best = { set: /** @type {string[]} */ ([]), n: 0 };
  for (const c of counts.values()) if (c.n > best.n) best = c;
  return best.set;
}

// ---- Predicates ----

/** A set of instances: bit i of word i >>> 5. */
/** @typedef {Uint32Array} Bits */
/**
 * One source key over the instances of a space: where it is present, where it is nonzero, and for
 * a key `in` may test, where it has each of its `values`.
 * @typedef {{ key: string, values: string[], has: Bits, nonzero: Bits, byValue: Bits[] | null }} Column
 */
/** The instances predicates are evaluated on: observations, or one group kind's (observation, group) pairs. */
/** @typedef {{ size: number, columns: Column[] }} Space */

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Whether `in` may test this key: booleans, enum-like codes and counts. @param {string} key @param {string[]} values */
function codeLike(key, values) {
  if (values.length > MAX_IN) return false;
  if (values.every((v) => v === 'true' || v === 'false')) return true;
  if (key.startsWith('pv:')) return values.every((v) => /^-?\d+$/.test(v));
  if (key.startsWith('ctrl:')) return values.every((v) => !DECIMAL.test(v.replace(/^"+|"+$/g, '')));
  if (key.startsWith('eva:')) return false;
  const last = key.slice(key.lastIndexOf('.') + 1).replace(/\[[^\]]*\]/g, '');
  return /^(uc|e)[A-Z0-9]/.test(last) || /^l\w*(Size|Count)$/.test(last);
}

/** Whether a value text is nonzero as `sourceNumber` reads it. @param {string} v */
function nonzero(v) {
  const src = { asc: new Map([['k', v]]), nBlocks: 0, pv: new Map(), ctrl: new Map(), eva: new Map(), sequence: '', seq: '' };
  return (sourceNumber(src, 'k') ?? 0) !== 0;
}

/** @param {number} n */
const newBits = (n) => new Uint32Array((n + 31) >>> 5);
/** @param {Bits} bits @param {number} i */
const setBit = (bits, i) => { bits[i >>> 5] |= 1 << (i & 31); };
/** @param {number} x */
function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}
/** How many instances are in the set. @param {Bits} a */
function count(a) {
  let n = 0;
  for (const x of a) if (x) n += popcount(x);
  return n;
}

/**
 * The columns of `n` instances, one per key, without keys that tell no instance from another.
 * @param {number} n
 * @param {(i: number, add: (key: string, value: string) => void) => void} each the entries of instance i
 * @returns {Column[]}
 */
function columnsOf(n, each) {
  /** @type {Map<string, { codes: Int32Array, index: Map<string, number> }>} */
  const cols = new Map();
  for (let i = 0; i < n; i++) {
    each(i, (key, value) => {
      let c = cols.get(key);
      if (!c) cols.set(key, c = { codes: new Int32Array(n).fill(-1), index: new Map() });
      let code = c.index.get(value);
      if (code === undefined) c.index.set(value, code = c.index.size);
      c.codes[i] = code;
    });
  }
  /** @type {Column[]} */
  const out = [];
  for (const key of [...cols.keys()].sort()) {
    const { codes, index } = /** @type {{ codes: Int32Array, index: Map<string, number> }} */ (cols.get(key));
    if (index.size === 1 && !codes.includes(-1)) continue;
    const values = [...index.keys()];
    const nz = values.map(nonzero);
    const col = { key, values, has: newBits(n), nonzero: newBits(n), byValue: codeLike(key, values) ? values.map(() => newBits(n)) : null };
    codes.forEach((c, i) => {
      if (c < 0) return;
      setBit(col.has, i);
      if (nz[c]) setBit(col.nonzero, i);
      if (col.byValue) setBit(col.byValue[c], i);
    });
    out.push(col);
  }
  return out;
}

/** A column of observations read per instance of a space whose instance i is of observation obs[i]. @param {Column} col @param {Int32Array} obs @returns {Column} */
function spread(col, obs) {
  /** @param {Bits} bits */
  const at = (bits) => {
    const out = newBits(obs.length);
    obs.forEach((o, i) => { if (bits[o >>> 5] & (1 << (o & 31))) setBit(out, i); });
    return out;
  };
  return { key: col.key, values: col.values, has: at(col.has), nonzero: at(col.nonzero), byValue: col.byValue && col.byValue.map(at) };
}

/** The source entries of an observation, keyed as `sourceValue` reads them. @param {CardSources} src @param {(key: string, value: string) => void} add */
function entries(src, add) {
  for (const [k, v] of src.asc) add(k, v);
  for (const [k, v] of src.pv) add(`pv:${k}`, v);
  for (const [k, v] of src.ctrl) add(`ctrl:${k}`, v);
  for (const [k, v] of src.eva) add(`eva:${k}`, v);
}

/**
 * The templated entries of an observation for group `g`: each `[g]` (and, in Preview keys, each
 * `.g` segment) replaced by `[#]` (`.#`) in turn.
 * @param {CardSources} src @param {number} g @param {(key: string, value: string) => void} add
 */
function groupEntries(src, g, add) {
  const bracket = `[${g}]`;
  entries(src, (key, value) => {
    if (key.includes(bracket)) {
      for (let at = key.indexOf(bracket); at >= 0; at = key.indexOf(bracket, at + 1)) add(`${key.slice(0, at)}[#]${key.slice(at + bracket.length)}`, value);
    }
    if (!key.startsWith('pv:')) return;
    for (const m of key.matchAll(/\.(\d+)(?=\.|$)/g)) if (Number(m[1]) === g) add(`${key.slice(0, m.index)}.#${key.slice(m.index + m[0].length)}`, value);
  });
}

/**
 * The predicate that best tells the `yes` instances from the `no` ones, with how many it gets
 * right; ties prefer `present`, then `nonzero`, then `in`, then the earlier key.
 * @param {Space} space
 * @param {Bits} yes
 * @param {Bits} no
 * @returns {{ pred: PredicateJson, agree: number } | null}
 */
function bestPredicate(space, yes, no) {
  const nYes = count(yes);
  const nNo = count(no);
  let lo = 0;
  let hi = yes.length;
  while (lo < hi && !(yes[lo] | no[lo])) lo++;
  while (hi > lo && !(yes[hi - 1] | no[hi - 1])) hi--;
  /** @param {Bits} bits @param {Bits} of */
  const within = (bits, of) => {
    let n = 0;
    for (let i = lo; i < hi; i++) if (bits[i] & of[i]) n += popcount(bits[i] & of[i]);
    return n;
  };
  /** @type {{ pred: PredicateJson, agree: number } | null} */
  let best = null;
  for (const col of space.columns) {
    let hy = 0;
    let hn = 0;
    let zy = 0;
    let zn = 0;
    for (let i = lo; i < hi; i++) {
      const h = col.has[i];
      if (h === 0) continue;
      const z = col.nonzero[i];
      if (h & yes[i]) hy += popcount(h & yes[i]);
      if (h & no[i]) hn += popcount(h & no[i]);
      if (z & yes[i]) zy += popcount(z & yes[i]);
      if (z & no[i]) zn += popcount(z & no[i]);
    }
    const present = hy + nNo - hn;
    if (!best || present > best.agree) best = { pred: { key: col.key, present: true }, agree: present };
    const nz = zy + nNo - zn;
    if (nz > best.agree) best = { pred: { key: col.key, nonzero: true }, agree: nz };
    if (!col.byValue) continue;
    const vals = nYes - hy > nNo - hn ? [ABSENT] : [];
    let agree = Math.max(nYes - hy, nNo - hn);
    col.byValue.forEach((bits, c) => {
      const y = within(bits, yes);
      const n = within(bits, no);
      agree += Math.max(y, n);
      if (y > n) vals.push(col.values[c]);
    });
    if (agree > best.agree) best = { pred: { key: col.key, in: vals.sort() }, agree };
  }
  return best;
}

/**
 * The layout of the catalog fitted to the observations, and what the fit had to resolve.
 * @param {Observation[]} observations
 * @returns {Layout & { report: LayoutReport }}
 */
export function fitLayout(observations) {
  /** @type {LayoutReport} */
  const report = { cycles: [], splitRuns: 0, parentFixes: 0 };
  const printed = observations.map((o) => o.cards.map((c) => ({ name: c.name, lines: cardLines(c) })));

  const cardNames = mergeOrder(distinct(printed.map((cs) => cs.map((c) => c.name))));
  if (cardNames.broken) report.cycles.push({ scope: '(cards)', broken: cardNames.broken });

  // Slots per card, and the final id of each fit key.
  /** @type {Record<string, LayoutSlot[]>} */
  const slots = {};
  /** @type {Map<string, Map<string, string>>} card -> fit key -> id */
  const idOf = new Map();
  for (const name of cardNames.order) {
    const ordered = cardOrder(name, printed.flatMap((cs) => cs.filter((c) => c.name === name).map((c) => c.lines)), report);
    const children = childIds(ordered.map((s) => s.key));
    const ids = new Map(ordered.map((s) => [s.key, children.get(s.key) ?? s.key]));
    idOf.set(name, ids);
    slots[name] = ordered.map((s) => ({
      id: /** @type {string} */ (ids.get(s.key)),
      ...(s.group !== null && { group: s.group }),
      ...(s.parent !== null && { parent: /** @type {string} */ (ids.get(s.parent)) }),
    }));
  }

  /** @type {Set<string>} `${card}\u0000${id}` of the slots printed with a `! ` or two-space prefix */
  const prefixed = new Set();
  // What each observation printed: per card, `${index}\u0000${id}` of each line, and of each `!` line.
  const seenLines = printed.map((cs) => new Map(cs.map((c) => {
    const ids = /** @type {Map<string, string>} */ (idOf.get(c.name));
    /** @type {Set<string>} */
    const lines = new Set();
    /** @type {Set<string>} */
    const bangs = new Set();
    /** @type {Map<GroupKind, number>} */
    const groups = new Map();
    for (const l of c.lines) {
      const at = `${l.index ?? ''}\u0000${ids.get(fitKey(l))}`;
      lines.add(at);
      if (l.bang) bangs.add(at);
      if (l.bang !== null) prefixed.add(`${c.name}\u0000${ids.get(fitKey(l))}`);
      if (l.group !== null) groups.set(l.group, Math.max(groups.get(l.group) ?? 0, /** @type {number} */ (l.index) + 1));
    }
    return [c.name, { lines, bangs, groups }];
  })));

  // Sequences: the most common card set; slots narrowed to those the sequence printed.
  /** @type {Record<string, LayoutSequence>} */
  const sequences = {};
  /** @type {Map<string, number[]>} */
  const bySequence = new Map();
  observations.forEach((o, i) => {
    if (!isProduct(o)) return;
    const list = bySequence.get(o.sequence) ?? [];
    list.push(i);
    bySequence.set(o.sequence, list);
  });
  for (const [seq, list] of [...bySequence].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const shown = new Set(modeSet(list.map((i) => [...seenLines[i].keys()])));
    const cards = cardNames.order.filter((c) => shown.has(c));
    /** @type {Record<string, string[]>} */
    const narrowed = {};
    for (const card of cards) {
      const ids = new Set(list.flatMap((i) => [...(seenLines[i].get(card)?.lines ?? [])].map((at) => at.slice(at.indexOf('\u0000') + 1))));
      const only = slots[card].map((s) => s.id).filter((id) => ids.has(id));
      if (only.length < slots[card].length) narrowed[card] = only;
    }
    sequences[seq] = Object.keys(narrowed).length ? { cards, slots: narrowed } : { cards };
  }

  // Predicate spaces: observations, and per group kind the printed (observation, group) pairs.
  const n = observations.length;
  /** @type {Space} */
  const obsSpace = { size: n, columns: columnsOf(n, (i, add) => entries(observations[i].src, add)) };
  /** @type {Map<GroupKind, { space: Space, index: Map<string, number> }>} */
  const groupSpaces = new Map();
  /** @param {GroupKind} kind */
  const groupSpace = (kind) => {
    const known = groupSpaces.get(kind);
    if (known) return known;
    /** @type {number[]} */
    const obs = [];
    /** @type {number[]} */
    const group = [];
    /** @type {Map<string, number>} */
    const index = new Map();
    seenLines.forEach((cards, i) => {
      let most = 0;
      for (const c of cards.values()) most = Math.max(most, c.groups.get(kind) ?? 0);
      for (let g = 0; g < most; g++) {
        index.set(`${i}\u0000${g}`, obs.length);
        obs.push(i);
        group.push(g);
      }
    });
    const of = Int32Array.from(obs);
    const templated = columnsOf(obs.length, (j, add) => groupEntries(observations[obs[j]].src, group[j], add));
    const made = { space: { size: obs.length, columns: [...obsSpace.columns.map((c) => spread(c, of)), ...templated] }, index };
    groupSpaces.set(kind, made);
    return made;
  };

  for (const card of cardNames.order) {
    for (const slot of slots[card]) {
      if (slot.id.endsWith('/#')) continue;
      const gs = slot.group ? groupSpace(slot.group) : null;
      const space = gs ? gs.space : obsSpace;
      const [shown, hidden, bang, plain] = [0, 0, 0, 0].map(() => newBits(space.size));
      observations.forEach((o, i) => {
        const c = seenLines[i].get(card);
        if (!c) return;
        const only = isProduct(o) ? sequences[o.sequence]?.slots?.[card] : undefined;
        if (only && !only.includes(slot.id)) return;
        const groups = slot.group ? Array.from({ length: c.groups.get(slot.group) ?? 0 }, (_, g) => g) : [null];
        for (const g of groups) {
          if (slot.parent && !c.lines.has(`${g ?? ''}\u0000${slot.parent}`)) continue;
          const at = `${g ?? ''}\u0000${slot.id}`;
          const j = gs ? /** @type {number} */ (gs.index.get(`${i}\u0000${g}`)) : i;
          setBit(c.lines.has(at) ? shown : hidden, j);
          if (c.lines.has(at)) setBit(c.bangs.has(at) ? bang : plain, j);
        }
      });
      const nShown = count(shown);
      if (count(hidden) > 0) {
        const best = bestPredicate(space, shown, hidden);
        if (best && best.agree > nShown) slot.when = best.pred;
      }
      if (!prefixed.has(`${card}\u0000${slot.id}`)) continue;
      if (count(bang) === 0) slot.bang = NEVER;
      else if (count(plain) === 0) slot.bang = ALWAYS;
      else slot.bang = /** @type {{ pred: PredicateJson }} */ (bestPredicate(space, bang, plain)).pred;
    }
  }
  return { cards: cardNames.order, sequences, slots, report };
}


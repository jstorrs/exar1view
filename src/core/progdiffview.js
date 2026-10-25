// @ts-check
/**
 * What the program-compare panel shows: the pair of programs a selection names, a program
 * comparison as rows of a side-by-side table (modelled on core/body.js flattenBody), the
 * collapsing of unchanged runs, and the status line. Pure.
 */
import { lookup } from './workspace.js';
import { ADD_IN_CONTENT } from './progdiff.js';
import { visibleText } from './visible.js';

/** @typedef {import('./workspace.js').Workspace} Workspace */
/** @typedef {import('./model.js').ExarFile} ExarFile */
/** @typedef {import('./model.js').Program} Program */
/** @typedef {import('./model.js').Step} Step */
/** @typedef {import('./model.js').Condition} Condition */
/** @typedef {import('./model.js').Choice} Choice */
/** @typedef {import('./progdiff.js').FieldDiff} FieldDiff */
/** @typedef {import('./progdiff.js').NodeCmp} NodeCmp */
/** @typedef {import('./progdiff.js').BranchCmp} BranchCmp */
/** @typedef {import('./progdiff.js').ProgramCmp} ProgramCmp */
/** @typedef {import('./progdiff.js').ProtocolCmp} ProtocolCmp */
/** @template T @typedef {import('./progdiff.js').Paired<T>} Paired */

/** One side of a program comparison: the program, its file and its Region › Exam labels. @typedef {{ file: ExarFile, path: string[], program: Program }} ProgramSide */

/** 'a' / 'b': on that side only. @typedef {'same' | 'changed' | 'a' | 'b'} Mark */
/** @typedef {{ key: string, depth: number, mark: Mark }} RowBase */
/** A choice of a side's fork: whether its branch is the default and has no steps. @typedef {{ choice: Choice, isDefault: boolean, empty: boolean }} ChoiceSide */
/**
 * A row of the table, in pre-order. `a` / `b` are the objects of each side (absent on the
 * missing side); `diffs` is present on pairs. `depth` is the number of enclosing forks: a
 * fork's split, condition and join rows sit at the fork's depth, its choice rows and their
 * steps one deeper.
 * @typedef {(RowBase & { type: 'header', diffs: FieldDiff[] })
 *   | (RowBase & { type: 'step', protocol?: ProtocolCmp } & Paired<Step>)
 *   | (RowBase & { type: 'split' | 'join' } & Paired<Step>)
 *   | (RowBase & { type: 'condition' } & Paired<Condition>)
 *   | (RowBase & { type: 'choice' } & Paired<ChoiceSide>)
 *   | { type: 'collapsed', key: string, depth: number, count: number }} CmpRow
 */
/** @typedef {{ changed: number, onlyA: number, onlyB: number }} CompareCounts */

export const PROGRAM_COMPARE_HINT = 'Select a program in each pane of split view';

/**
 * @param {Workspace} ws
 * @param {string} key
 * @returns {ProgramSide | null}
 */
function sideOf(ws, key) {
  const loc = lookup(ws, key);
  if (loc?.level !== 'program') return null;
  const [file, region, exam] = loc.ancestors;
  return { file, path: [region.label, exam.label], program: loc.node };
}

/**
 * The two different programs `keys` names, in that order, or null.
 * @param {Workspace} ws
 * @param {readonly string[]} keys selected keys
 * @returns {{ a: ProgramSide, b: ProgramSide } | null}
 */
export function programPair(ws, keys) {
  if (keys.length !== 2 || keys[0] === keys[1]) return null;
  const a = sideOf(ws, keys[0]);
  const b = sideOf(ws, keys[1]);
  return a && b ? { a, b } : null;
}

/** @param {Paired<unknown>} p @param {FieldDiff[]} diffs @returns {Mark} */
const markOf = (p, diffs) => (p.in !== 'both' ? p.in : diffs.length > 0 ? 'changed' : 'same');

/**
 * `p` with each side mapped through `f`; a pair gets `diffs`.
 * @template T, U
 * @param {Paired<T>} p
 * @param {(x: T) => U} f
 * @param {FieldDiff[]} diffs
 * @returns {Paired<U>}
 */
function project(p, f, diffs) {
  if (p.in === 'both') return { in: 'both', a: f(p.a), b: f(p.b), diffs };
  return p.in === 'a' ? { in: 'a', a: f(p.a) } : { in: 'b', b: f(p.b) };
}

/** Identity of a thing by what is on each side. @param {Paired<{ key: string }>} p */
const pairKey = (p) => `${p.in !== 'b' ? p.a.key : ''}|${p.in !== 'a' ? p.b.key : ''}`;

const JOIN = 'Join ';
const CONDITION_FIELDS = new Set(['Condition', 'Description', 'Choices']);

/**
 * The comparison as rows, pre-order. A fork gives a split row, a condition row, per branch a
 * choice row followed by the branch's rows, then a join row. The condition row holds the
 * fork's Condition / Description / Choices differences, the join row those prefixed `Join `
 * (prefix stripped), the split row the rest.
 * @param {ProgramCmp} cmp
 * @returns {CmpRow[]}
 */
export function compareRows(cmp) {
  /** @type {CmpRow[]} */
  const rows = [];
  if (cmp.header.length > 0) rows.push({ type: 'header', key: 'header', depth: 0, mark: 'changed', diffs: cmp.header });

  /** @param {readonly NodeCmp[]} nodes @param {number} depth */
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      if (n.type === 'step') {
        const diffs = n.in === 'both' ? n.diffs : [];
        const mark = n.in === 'both' ? (diffs.length > 0 || n.protocol === 'differs' ? 'changed' : 'same') : n.in;
        rows.push({ ...n, key: `s:${pairKey(n)}`, depth, mark });
        continue;
      }
      const all = n.in === 'both' ? n.diffs : [];
      const joinDiffs = all.filter((d) => d.field.startsWith(JOIN)).map((d) => ({ ...d, field: d.field.slice(JOIN.length) }));
      const condDiffs = all.filter((d) => CONDITION_FIELDS.has(d.field));
      const splitDiffs = all.filter((d) => !d.field.startsWith(JOIN) && !CONDITION_FIELDS.has(d.field));
      const split = project(n, (f) => f.split, splitDiffs);
      const id = pairKey(split);
      rows.push({ type: 'split', key: `split:${id}`, depth, mark: markOf(n, splitDiffs), ...split });
      rows.push({ type: 'condition', key: `c:${id}`, depth, mark: markOf(n, condDiffs), ...project(n, (f) => f.condition, condDiffs) });
      for (const br of n.branches) {
        const diffs = br.in === 'both' ? br.diffs : [];
        const oid = br.in === 'both' ? `${br.a.choice.objectId}|${br.b.choice.objectId}` : br.in === 'a' ? `${br.a.choice.objectId}|` : `|${br.b.choice.objectId}`;
        rows.push({ type: 'choice', key: `b:${id}:${oid}`, depth: depth + 1, mark: markOf(br, diffs), ...project(br, (b) => ({ choice: b.choice, isDefault: b.isDefault, empty: b.body.length === 0 }), diffs) });
        walk(br.body, depth + 1);
      }
      rows.push({ type: 'join', key: `join:${id}`, depth, mark: markOf(n, joinDiffs), ...project(n, (f) => f.join, joinDiffs) });
    }
  };
  walk(cmp.body, 0);
  return rows;
}

/**
 * Replace each run of at least `min` consecutive unchanged step rows with one collapsed row
 * unless `show`. Any other row (even an unchanged one) ends a run.
 * @param {readonly CmpRow[]} rows
 * @param {boolean} show
 * @param {number} [min]
 * @returns {CmpRow[]}
 */
export function collapseSame(rows, show, min = 4) {
  if (show) return [...rows];
  /** @type {CmpRow[]} */
  const out = [];
  /** @type {CmpRow[]} */
  let run = [];
  const flush = () => {
    out.push(...(run.length > 0 && run.length >= min ? [{ type: /** @type {const} */ ('collapsed'), key: `collapsed:${run[0].key}`, depth: run[0].depth, count: run.length }] : run));
    run = [];
  };
  for (const r of rows) {
    if (r.type === 'step' && r.mark === 'same') run.push(r);
    else { flush(); out.push(r); }
  }
  flush();
  return out;
}

/**
 * Differences by kind, each thing once. Every row counts by its mark, except: a choice row
 * counts only when one-sided; a fork counts once, at its join row, with its split, condition
 * and join rows' marks combined ('changed' if any of them is, else the split's, so a one-sided
 * fork is one-sided).
 * @param {readonly CmpRow[]} rows
 * @returns {CompareCounts}
 */
export function compareCounts(rows) {
  const counts = { changed: 0, onlyA: 0, onlyB: 0 };
  /** @param {Mark} m */
  const tally = (m) => {
    if (m === 'changed') counts.changed++;
    else if (m === 'a') counts.onlyA++;
    else if (m === 'b') counts.onlyB++;
  };
  /** @type {Mark[]} */
  const forks = [];
  for (const r of rows) {
    if (r.type === 'split') forks.push(r.mark);
    else if (r.type === 'condition') {
      if (r.mark === 'changed') forks[forks.length - 1] = 'changed';
    } else if (r.type === 'join') {
      const split = /** @type {Mark} */ (forks.pop());
      tally(r.mark === 'changed' ? 'changed' : split);
    } else if (r.type === 'choice') {
      if (r.mark === 'a' || r.mark === 'b') tally(r.mark); // a moved default is already the fork's Choices change
    } else if (r.type !== 'collapsed') tally(r.mark);
  }
  return counts;
}

/**
 * @param {CompareCounts} counts
 * @returns {string}
 */
export function programCompareStatus({ changed, onlyA, onlyB }) {
  const parts = [
    ...(changed > 0 ? [`${changed} changed`] : []),
    ...(onlyA > 0 ? [`${onlyA} only in A`] : []),
    ...(onlyB > 0 ? [`${onlyB} only in B`] : []),
  ];
  return parts.length > 0 ? parts.join(' · ') : 'No differences in steps, decisions or branches';
}

/**
 * A warning when a side's step order fell back to rank, else null. Never quotes the document.
 * @param {{ a: ProgramSide, b: ProgramSide }} pair
 * @returns {string | null}
 */
export function rankWarning({ a, b }) {
  const [ra, rb] = [a.program.order === 'rank', b.program.order === 'rank'];
  if (!ra && !rb) return null;
  if (ra && rb) return 'Step order in A and B could not be read from their links; steps are shown by rank.';
  return `Step order in ${ra ? 'A' : 'B'} could not be read from its links; steps are shown by rank.`;
}

/**
 * A differing field's value as shown, like the facts panel: null (not set) as "—", empty as
 * "(empty)", control characters as pictures. An add-in's content is a hash: only "differs".
 * @param {string} field
 * @param {string | null} value
 * @returns {string}
 */
export function diffValue(field, value) {
  if (field === ADD_IN_CONTENT) return 'differs';
  return value === null ? '—' : value === '' ? '(empty)' : visibleText(value);
}

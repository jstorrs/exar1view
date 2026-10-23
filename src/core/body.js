// @ts-check
/**
 * A program's body as display rows (adapted from protocols-web core/body.js). Pure.
 *
 * Pre-order, branches in the condition's choice order. A fork gives its Split step, a
 * condition row, per branch a choice row followed by the branch's rows, then its Join
 * step. Split and Join are real steps (selectable, like any other); condition and choice
 * rows only show the structure. `depth` is the number of enclosing forks: a fork's Split,
 * condition and Join rows sit at the fork's depth, its choice rows and their steps one
 * deeper.
 */

import { visibleControls } from './visible.js';

/** @typedef {import('./model.js').Program} Program */
/** @typedef {import('./model.js').BodyNode} BodyNode */
/** @typedef {import('./model.js').Step} Step */
/** @typedef {import('./model.js').Condition} Condition */
/** @typedef {import('./model.js').Choice} Choice */
/** @typedef {import('./model.js').CopyRef} CopyRef */

/**
 * `branch`: the innermost branch the step is in, null at the top level. `fork`: on a Split
 * or Join step, its fork's condition and the choices whose branch is empty.
 * @typedef {{type: 'step', key: string, depth: number, step: Step,
 *     branch: {condition: Condition, choice: Choice, isDefault: boolean} | null,
 *     fork: {condition: Condition, empty: Choice[]} | null}
 *   | {type: 'condition', key: string, depth: number, condition: Condition}
 *   | {type: 'choice', key: string, depth: number, condition: Condition, choice: Choice,
 *     isDefault: boolean, empty: boolean}} BodyRow
 */
/** @typedef {Extract<BodyRow, {type: 'step'}>} StepRow */

/**
 * @param {Program} program
 * @returns {BodyRow[]}
 */
export function flattenBody(program) {
  /** @type {BodyRow[]} */
  const rows = [];
  /**
   * @param {readonly BodyNode[]} nodes
   * @param {number} depth
   * @param {StepRow['branch']} branch
   */
  const walk = (nodes, depth, branch) => {
    for (const n of nodes) {
      if (n.type === 'step') {
        rows.push({ type: 'step', key: n.step.key, depth, step: n.step, branch, fork: null });
        continue;
      }
      const { condition } = n;
      const empty = n.branches.filter((b) => b.body.length === 0).map((b) => b.choice);
      rows.push({ type: 'step', key: n.split.key, depth, step: n.split, branch, fork: { condition, empty } });
      rows.push({ type: 'condition', key: `c:${n.split.key}`, depth, condition });
      for (const b of n.branches) {
        rows.push({
          type: 'choice', key: `b:${n.split.key}:${b.choice.objectId}`, depth: depth + 1,
          condition, choice: b.choice, isDefault: b.isDefault, empty: b.body.length === 0,
        });
        walk(b.body, depth + 1, { condition, choice: b.choice, isDefault: b.isDefault });
      }
      rows.push({ type: 'step', key: n.join.key, depth, step: n.join, branch, fork: { condition, empty: [] } });
    }
  };
  walk(program.body, 0, null);
  return rows;
}

/**
 * The structural part of a step row's accessible name (the condition and choice rows are
 * hidden from assistive technology, so their information goes here): kind and label; on a
 * Split or Join its condition, and on a Split the choices with no steps; inside a branch,
 * the condition and choice it is in.
 * @param {StepRow} row
 * @returns {string}
 */
export function stepRowLabel({ step, fork, branch }) {
  const parts = [step.kind, visibleControls(step.label)];
  if (fork) {
    parts.push(`${fork.condition.kind} ${visibleControls(fork.condition.label)}`);
    if (fork.empty.length) parts.push(`no steps for ${fork.empty.map((c) => visibleControls(c.label)).join(', ')}`);
  }
  if (branch) {
    parts.push(`in ${visibleControls(branch.condition.label)}: ${visibleControls(branch.choice.label)}${branch.isDefault ? ' (default)' : ''}`);
  }
  return parts.join(', ');
}

/** @param {readonly BodyRow[]} rows @returns {StepRow[]} */
export const stepRows = (rows) => rows.flatMap((r) => (r.type === 'step' ? [r] : []));

/**
 * Copy references per step ObjectId (they reference ObjectIds, not ElementIds), in the
 * program's order.
 * @param {Program} program
 * @returns {Map<string, {outgoing: CopyRef[], incoming: CopyRef[]}>}
 */
export function copyRefMarks(program) {
  /** @type {Map<string, {outgoing: CopyRef[], incoming: CopyRef[]}>} */
  const marks = new Map();
  /** @param {string} id */
  const at = (id) => {
    let m = marks.get(id);
    if (!m) { m = { outgoing: [], incoming: [] }; marks.set(id, m); }
    return m;
  };
  for (const ref of program.copyRefs) {
    at(ref.source).outgoing.push(ref);
    at(ref.target).incoming.push(ref);
  }
  return marks;
}

/** The start of the reader's warning when it falls back to rank order (see core/program.js). */
const RANK_PREFIX = 'steps are shown in rank order: ';

/**
 * Why the program's steps are in rank order: the reason from its warning, '' when the warning
 * is missing, null when the order was read from the links.
 * @param {Program} program
 * @returns {string | null}
 */
export function rankReason(program) {
  if (program.order !== 'rank') return null;
  const p = program.problems.find((q) => q.message.startsWith(RANK_PREFIX));
  return p ? p.message.slice(RANK_PREFIX.length) : '';
}

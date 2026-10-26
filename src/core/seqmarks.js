// @ts-check
/**
 * Which tree rows and steps to mark after a file is analyzed: the steps whose protocol
 * uses a customer or unrecognised reference (the report's By program set), their programs, and
 * every exam, region and tree containing those programs. Pure.
 */
import { ancestorKeys } from './treeview.js';

/** @typedef {import('./workspace.js').Workspace} Workspace */
/** @typedef {import('./seqreport.js').SequenceReport} SequenceReport */

/** Nothing marked (before any analysis). @type {ReadonlySet<string>} */
export const NO_MARKS = new Set();

/**
 * @param {Workspace} ws
 * @param {SequenceReport} report
 * @returns {ReadonlySet<string>} step, program, exam, region and tree keys
 */
export function markedKeys(ws, report) {
  /** @type {Set<string>} */ const keys = new Set();
  for (const p of report.byProgram) {
    keys.add(p.programKey);
    for (const k of ancestorKeys(ws, p.programKey)) keys.add(k);
    for (const r of p.refs) for (const u of r.uses) keys.add(u.stepKey);
  }
  return keys;
}

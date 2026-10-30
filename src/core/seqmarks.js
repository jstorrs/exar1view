// @ts-check
/**
 * Which tree rows and steps to mark after a file is analyzed. Customer marks: the steps whose
 * protocol uses a customer or unrecognised reference (the report's By program set), their
 * programs, and every exam, region and tree containing those programs. Upgrade marks: the steps
 * whose protocol has upgrade notes, with the same containers. Pure.
 */
import { displaySteps, measurementDetail } from './model.js';
import { ancestorKeys } from './treeview.js';

/** @typedef {import('./model.js').ExarFile} ExarFile */
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

/**
 * @param {ExarFile} file
 * @param {ReadonlySet<string>} upgrades protocol blobs with upgrade notes
 * @returns {ReadonlySet<string>} step, program, exam, region and tree keys
 */
export function upgradeKeys(file, upgrades) {
  /** @type {Set<string>} */ const keys = new Set();
  for (const region of file.regions) for (const exam of region.exams) for (const program of exam.programs) {
    for (const step of displaySteps(program.body)) {
      const blob = measurementDetail(step)?.protocolBlob;
      if (!blob || !upgrades.has(blob)) continue;
      keys.add(step.key).add(program.key).add(exam.key).add(region.key);
      if (region.tree) keys.add(region.tree.key);
    }
  }
  return keys;
}

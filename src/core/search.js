// @ts-check
/**
 * Pure label filter for one file's tree. Programs are the tree's leaves; their steps live
 * in the step list, so a step match shows (and counts on) its program.
 * @typedef {import('./model.js').ExarFile} ExarFile
 */
import { displaySteps } from './model.js';

/**
 * @typedef {object} Filter
 * @property {Set<string>} visible trees, regions, exams and programs to show: matching ones, those with a
 *   matching descendant, and those under a matching ancestor
 * @property {Set<string>} matches trees, regions, exams, programs and steps whose own label matches
 * @property {Set<string>} expand trees, regions and exams with a matching descendant (to auto-expand), and
 *   programs with a matching step (styled as holding a match)
 * @property {Map<string, number>} stepHits program key -> number of its matching steps (only when > 0)
 */

/**
 * Case-insensitive substring filter over tree, region, exam, program and step labels.
 * @param {ExarFile} file
 * @param {string} query
 * @returns {Filter | null} null only for the empty string (no filter); whitespace is significant,
 *   so the query is matched as given, never trimmed
 */
export function filterFile(file, query) {
  if (query === '') return null;
  const q = query.toLowerCase();
  /** @param {string} label */
  const hit = (label) => label.toLowerCase().includes(q);
  /** @type {Filter} */
  const out = { visible: new Set(), matches: new Set(), expand: new Set(), stepHits: new Map() };

  /** Mark `keys` (ancestor containers of a match) visible and expandable. */
  const markAncestors = (/** @type {string[]} */ keys) => {
    for (const k of keys) { out.visible.add(k); out.expand.add(k); }
  };

  for (const region of file.regions) {
    const treeHit = region.tree ? hit(region.tree.label) : false;
    const regionHit = hit(region.label);
    const regionUnder = treeHit || regionHit;
    if (regionHit) out.matches.add(region.key);
    if (regionUnder) out.visible.add(region.key);
    for (const exam of region.exams) {
      const examHit = hit(exam.label);
      const examUnder = regionUnder || examHit;
      if (examHit) out.matches.add(exam.key);
      if (examUnder) { out.visible.add(region.key); out.visible.add(exam.key); }
      if (examHit) markAncestors([region.key]);
      for (const program of exam.programs) {
        const programHit = hit(program.label);
        const stepHits = displaySteps(program.body).filter((s) => hit(s.label));
        for (const s of stepHits) out.matches.add(s.key);
        if (programHit) out.matches.add(program.key);
        if (examUnder || programHit || stepHits.length) {
          out.visible.add(region.key); out.visible.add(exam.key); out.visible.add(program.key);
        }
        if (programHit || stepHits.length) markAncestors([region.key, exam.key]);
        if (stepHits.length) {
          out.expand.add(program.key);
          out.stepHits.set(program.key, stepHits.length);
        }
      }
    }
    // A region's tree (only in a file with several trees) shows when it matches or holds a
    // shown region, and auto-expands when it holds a match.
    if (region.tree) {
      const key = region.tree.key;
      if (treeHit) { out.matches.add(key); out.visible.add(key); }
      if (out.visible.has(region.key)) out.visible.add(key);
      if (regionHit || out.expand.has(region.key)) out.expand.add(key);
    }
  }
  return out;
}

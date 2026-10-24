// @ts-check
/**
 * What the compare panel shows (adapted from protocols-web core/diffview.js): the pair of
 * measurement steps a selection names, the status line, and the parameter differences as table
 * rows with a key filter and the churn/ignored tiers hidden unless asked for. Pure.
 */
import { lookup } from './workspace.js';
import { TIER_ORDER } from './tiers.js';

/** @typedef {import('./workspace.js').Workspace} Workspace */
/** @typedef {import('./model.js').ExarFile} ExarFile */
/** @typedef {import('./model.js').Step} Step */
/** @typedef {import('./ascconv.js').Block} Block */
/** @typedef {import('./paramdiff.js').ParamDiff} ParamDiff */
/** @typedef {import('./tiers.js').Tier} Tier */

/**
 * One side of a comparison: the step, its file and its Region › Exam › Program labels.
 * @typedef {{ file: ExarFile, path: string[], step: Extract<Step, { kind: 'Measurement' }> }} Side
 */
/** `block` is "Main" or "Sub-protocol n"; a null value is absent (the scanner default). */
/** @typedef {{ block: string, key: string, tier: Tier, a: string | null, b: string | null }} DiffRow */

export const COMPARE_HINT = 'Select two measurement steps (in one pane or one in each pane)';

/** Tiers left out unless "Show churn/ignored" is on. @type {ReadonlySet<Tier>} */
const NOISE = new Set(/** @type {Tier[]} */ (['churn', 'ignored']));

/**
 * The step with `key` as a comparison side, or null unless it is a measurement step.
 * @param {Workspace} ws
 * @param {string} key
 * @returns {Side | null}
 */
function sideOf(ws, key) {
  const loc = lookup(ws, key);
  if (loc?.level !== 'step' || loc.node.kind !== 'Measurement') return null;
  const [file, region, exam, program] = loc.ancestors;
  return { file, path: [region.label, exam.label, program.label], step: loc.node };
}

/**
 * The two measurement steps `keys` names, in that order, or null unless there are exactly two.
 * @param {Workspace} ws
 * @param {readonly string[]} keys selected step keys (see store.js shownSelection)
 * @returns {{ a: Side, b: Side } | null}
 */
export function measurementPair(ws, keys) {
  if (keys.length !== 2) return null;
  const a = sideOf(ws, keys[0]);
  const b = sideOf(ws, keys[1]);
  return a && b ? { a, b } : null;
}

/** @param {number} block */
export const blockName = (block) => (block === 0 ? 'Main' : `Sub-protocol ${block}`);

/**
 * The status line: the same protocol blob, no parameter differences, or how many differ.
 * @param {boolean} sameBlob
 * @param {number} differ
 */
export function compareStatus(sameBlob, differ) {
  if (sameBlob) return 'Same protocol';
  if (differ === 0) return 'Same parameters, other text differs';
  return differ === 1 ? '1 parameter differs' : `${differ} parameters differ`;
}

/**
 * The main protocol's sequence file name without its quotes, or null when not set.
 * @param {readonly Block[]} blocks
 */
export function sequenceName(blocks) {
  const raw = blocks[0]?.get('tSequenceFileName');
  if (raw === undefined) return null;
  return raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

/**
 * Rows of the table: blocks in order, by tier within a block. `query` keeps keys containing it
 * (ignoring case); `hidden` counts the rows it keeps that are churn or ignored and not shown.
 * @param {readonly ParamDiff[]} diffs
 * @param {{ query: string, showNoise: boolean }} opts
 * @returns {{ rows: DiffRow[], hidden: number }}
 */
export function diffRows(diffs, { query, showNoise }) {
  const q = query.trim().toLowerCase();
  const matching = q === '' ? diffs : diffs.filter((d) => d.key.toLowerCase().includes(q));
  const shown = showNoise ? matching : matching.filter((d) => !NOISE.has(d.tier));
  const rank = (/** @type {ParamDiff} */ d) => d.block * TIER_ORDER.length + TIER_ORDER.indexOf(d.tier);
  return {
    rows: [...shown].sort((x, y) => rank(x) - rank(y))
      .map((d) => ({ block: blockName(d.block), key: d.key, tier: d.tier, a: d.a, b: d.b })),
    hidden: matching.length - shown.length,
  };
}

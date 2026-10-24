// @ts-check
/** Parameter differences between two parsed protocols (ported from protocol_tools/compare/params.py). Pure. */
import { tierOf } from './tiers.js';

/** @typedef {import('./ascconv.js').Block} Block */
/** @typedef {import('./tiers.js').Tier} Tier */
/**
 * One differing parameter; `block` is 0-based and null means absent (scanner default).
 * @typedef {{ block: number, key: string, tier: Tier, a: string | null, b: string | null }} ParamDiff
 */

/** @type {Block} */
const EMPTY = new Map();

/**
 * Differences block by block, every tier included; a missing block counts as empty.
 * Within a block: A's keys in A's order, then B-only keys in B's order.
 * @param {readonly Block[]} a
 * @param {readonly Block[]} b
 * @returns {ParamDiff[]}
 */
export function diffParams(a, b) {
  /** @type {ParamDiff[]} */
  const diffs = [];
  for (let block = 0; block < Math.max(a.length, b.length); block++) {
    const pa = a[block] ?? EMPTY;
    const pb = b[block] ?? EMPTY;
    for (const key of [...pa.keys(), ...[...pb.keys()].filter((k) => !pa.has(k))]) {
      const va = pa.get(key) ?? null;
      const vb = pb.get(key) ?? null;
      if (va !== vb) diffs.push({ block, key, tier: tierOf(key), a: va, b: vb });
    }
  }
  return diffs;
}

// @ts-check
/**
 * What the protocol panel lists: each ASCCONV block's parameters in text order, filtered on the
 * key as the compare panel filters (core/diffview.js diffRows). Pure.
 */
import { blockName } from './diffview.js';

/** @typedef {import('./ascconv.js').Block} Block */
/** Each block's keys, lower-cased, in text order (see keyIndex). @typedef {readonly (readonly string[])[]} KeyIndex */
/**
 * A block with keys that match: `block` its 0-based number, `lines` the matching keys' positions
 * in text order.
 * @typedef {{ block: number, title: string, lines: number[] }} ParamSection
 */

/** @param {readonly Block[]} blocks @returns {KeyIndex} */
export const keyIndex = (blocks) => blocks.map((b) => [...b.keys()].map((k) => k.toLowerCase()));

/** A block's heading: "Main protocol", then "Sub-protocol n" as blockName names them. @param {number} block */
export const blockTitle = (block) => (block === 0 ? 'Main protocol' : blockName(block));

/**
 * The blocks with keys containing `query` (ignoring case and surrounding spaces; empty keeps all),
 * each with its matching lines; `empty` says why there are none (null when there are).
 * @param {KeyIndex} index
 * @param {string} query
 * @returns {{ sections: ParamSection[], empty: string | null }}
 */
export function paramSections(index, query) {
  const q = query.trim().toLowerCase();
  const sections = index.flatMap((keys, block) => {
    const lines = keys.flatMap((k, i) => (k.includes(q) ? [i] : []));
    return lines.length ? [{ block, title: blockTitle(block), lines }] : [];
  });
  /** @type {string | null} */
  let empty = null;
  if (sections.length === 0) empty = index.every((keys) => keys.length === 0) ? 'No parameters' : 'No matching parameters';
  return { sections, empty };
}

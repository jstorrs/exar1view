// @ts-check
/**
 * Decoded content documents as the loader hands them on, and the label/comment lookups
 * over an instance's documents. Pure.
 */
import { contentTypeOf, labelText } from './edf.js';
import { FormatError } from './errors.js';

/** @typedef {import('./json.js').Json} Json */
/** @typedef {import('./edf.js').ContentType} ContentType */
/** @typedef {import('./head.js').InstanceRow} InstanceRow */

/**
 * One Content row after inflate and decode, or why that failed.
 * @typedef {{ ok: true, type: ContentType, body: Record<string, Json> }
 *   | { ok: false, message: string }} DocResult
 */

/** What a label shows when its string cannot be resolved. */
export const NO_LABEL = '(no label)';

/**
 * The body of `row`'s own document. Throws a FormatError naming the instance when the
 * Content row is missing, did not decode, or is of another content type.
 * @param {InstanceRow} row
 * @param {ReadonlyMap<string, DocResult>} docs by content hash
 * @returns {Record<string, Json>}
 */
export function docBody(row, docs) {
  const res = docs.get(row.contentHash);
  const ctx = `${row.type} ${row.element}`;
  if (res === undefined) throw new FormatError(`${ctx}: no content`);
  if (!res.ok) throw new FormatError(`${ctx}: ${res.message}`);
  if (res.type !== contentTypeOf(row.type)) throw new FormatError(`${ctx}: content type is ${res.type}`);
  return res.body;
}

/**
 * Display text of the EdfString element `target` of `row`.
 * @param {string | null} target element id
 * @param {string} what "label" or "description"
 * @param {ReadonlyMap<string, InstanceRow>} instances by element id
 * @param {ReadonlyMap<string, DocResult>} docs
 */
function stringText(target, what, instances, docs) {
  if (target === null) throw new FormatError(`no ${what} element`);
  const row = instances.get(target);
  if (row === undefined) throw new FormatError(`${what} element ${target} is not in the head`);
  if (row.type !== 'EdfString') throw new FormatError(`${what} element ${target} is a ${row.type}, not an EdfString`);
  return labelText(docBody(row, docs));
}

/**
 * The label of `row`; on failure `report` gets the reason and the label is `NO_LABEL`.
 * @param {InstanceRow} row
 * @param {ReadonlyMap<string, InstanceRow>} instances
 * @param {ReadonlyMap<string, DocResult>} docs
 * @param {(message: string) => void} report
 * @returns {string}
 */
export function labelOf(row, instances, docs, report) {
  try {
    return stringText(row.label, 'label', instances, docs);
  } catch (err) {
    if (!(err instanceof FormatError)) throw err;
    report(err.message);
    return NO_LABEL;
  }
}

/**
 * The comment of `row` (empty or absent is null); on failure `report` gets the reason and
 * the comment is null.
 * @param {InstanceRow} row
 * @param {ReadonlyMap<string, InstanceRow>} instances
 * @param {ReadonlyMap<string, DocResult>} docs
 * @param {(message: string) => void} report
 * @returns {string | null}
 */
export function commentOf(row, instances, docs, report) {
  if (row.description === null) return null;
  try {
    return stringText(row.description, 'description', instances, docs) || null;
  } catch (err) {
    if (!(err instanceof FormatError)) throw err;
    report(err.message);
    return null;
  }
}

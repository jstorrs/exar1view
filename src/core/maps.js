// @ts-check
import { FormatError } from './errors.js';
import { NIL, guidFromBytesLe } from './guid.js';

const PAIR = 32;

/**
 * ElementToInstanceMap blob: packed (element GUID, instance GUID) pairs.
 * A nil instance (null) marks a removal in a delta.
 * @param {Uint8Array} bytes
 * @returns {[string, string | null][]}
 */
export function decodeMap(bytes) {
  if (bytes.length % PAIR) throw new FormatError(`element map: length ${bytes.length} is not a multiple of ${PAIR}`);
  /** @type {[string, string | null][]} */
  const pairs = [];
  const seen = new Set();
  for (let i = 0; i < bytes.length; i += PAIR) {
    const element = guidFromBytesLe(bytes, i);
    const instance = guidFromBytesLe(bytes, i + 16);
    if (element === NIL) throw new FormatError(`element map: nil element id at offset ${i}`);
    if (seen.has(element)) throw new FormatError(`element map: duplicate element ${element} at offset ${i}`);
    seen.add(element);
    pairs.push([element, instance === NIL ? null : instance]);
  }
  return pairs;
}

/**
 * Resolve a change set's element map: the base entries, then the delta's updates and removals.
 * @param {Iterable<[string, string | null]>} base
 * @param {Iterable<[string, string | null]>} delta
 * @returns {Map<string, string>}
 */
export function applyMaps(base, delta) {
  /** @type {Map<string, string>} */
  const resolved = new Map();
  for (const [element, instance] of base) {
    if (instance === null) throw new FormatError(`base element map: nil instance for element ${element}`);
    resolved.set(element, instance);
  }
  for (const [element, instance] of delta) {
    if (instance === null) resolved.delete(element);
    else resolved.set(element, instance);
  }
  return resolved;
}

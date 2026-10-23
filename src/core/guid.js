// @ts-check
import { FormatError } from './errors.js';

export const NIL = '00000000-0000-0000-0000-000000000000';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * True for a canonical lowercase 8-4-4-4-12 GUID string.
 * @param {unknown} s
 * @returns {s is string}
 */
export function isGuid(s) {
  return typeof s === 'string' && GUID.test(s);
}

/**
 * Read 16 bytes in .NET order (first three groups little-endian, the rest as written)
 * at `offset`; equivalent to Python's `uuid.UUID(bytes_le=...)`.
 * @param {Uint8Array} bytes
 * @param {number} [offset]
 * @returns {string}
 */
export function guidFromBytesLe(bytes, offset = 0) {
  if (offset < 0 || offset + 16 > bytes.length) {
    throw new FormatError(`GUID: need 16 bytes at offset ${offset}, have ${bytes.length}`);
  }
  /** @param {number} from @param {number} to @param {boolean} reverse */
  const hex = (from, to, reverse) => {
    const part = Array.from(bytes.subarray(offset + from, offset + to), (b) => b.toString(16).padStart(2, '0'));
    return (reverse ? part.reverse() : part).join('');
  };
  return [hex(0, 4, true), hex(4, 6, true), hex(6, 8, true), hex(8, 10, false), hex(10, 16, false)].join('-');
}

/**
 * A nullable GUID column: NULL, empty and the nil GUID mean "none" (null).
 * Anything else must be a canonical GUID or this throws.
 * @param {string | null | undefined} s
 * @param {string} [ctx] where the value came from, for the error message
 * @returns {string | null}
 */
export function optGuid(s, ctx = 'GUID') {
  if (s === null || s === undefined || s === '') return null;
  if (!isGuid(s)) throw new FormatError(`${ctx}: not a canonical lowercase GUID: ${JSON.stringify(s)}`);
  return s === NIL ? null : s;
}

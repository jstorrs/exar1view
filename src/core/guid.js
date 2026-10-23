// @ts-check
import { FormatError } from './errors.js';

export const NIL = '00000000-0000-0000-0000-000000000000';

/** Two lowercase hex digits for every byte value. */
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

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
  const h = (/** @type {number} */ i) => HEX[bytes[offset + i]];
  return `${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
}

/**
 * A nullable GUID column: NULL, empty and the nil GUID mean "none" (null).
 * Anything else must be a canonical GUID or this throws; the message never quotes the value.
 * @param {string | null | undefined} s
 * @param {string} [ctx] where the value came from, for the error message
 * @returns {string | null}
 */
export function optGuid(s, ctx = 'GUID') {
  if (s === null || s === undefined || s === '') return null;
  if (!isGuid(s)) throw new FormatError(`${ctx}: not a canonical lowercase GUID`);
  return s === NIL ? null : s;
}

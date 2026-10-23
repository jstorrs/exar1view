// @ts-check
import { FormatError } from './errors.js';

/** @typedef {null | boolean | number | string | JsonArray | JsonObject} Json */
/** @typedef {Json[]} JsonArray */
/** @typedef {{ [key: string]: Json }} JsonObject */

/** @param {unknown} v */
function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Turn a Json.NET document into plain data: `$`-prefixed keys are dropped, and an
 * object holding `$values` (with only `$` siblings) becomes that array. `$ref` throws.
 * @param {unknown} value
 * @returns {Json}
 */
export function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!isObject(value)) return /** @type {Json} */ (value);
  if ('$ref' in value) throw new FormatError('unresolved Json.NET $ref');
  const keys = Object.keys(value);
  if ('$values' in value) {
    const extra = keys.filter((k) => !k.startsWith('$'));
    if (extra.length) throw new FormatError(`'$values' object has sibling keys: ${JSON.stringify(extra)}`);
    if (!Array.isArray(value.$values)) throw new FormatError(`'$values' must be an array, got ${typeName(value.$values)}`);
    return value.$values.map(normalize);
  }
  // fromEntries defines own properties, so a "__proto__" key stays data
  return Object.fromEntries(keys.filter((k) => !k.startsWith('$')).map((k) => [k, normalize(value[k])]));
}

/**
 * @param {Record<string, Json>} o
 * @param {string} key
 * @param {string} ctx
 * @returns {Json}
 */
function get(o, key, ctx) {
  if (!Object.hasOwn(o, key)) throw new FormatError(`${ctx}: missing key ${JSON.stringify(key)}`);
  return o[key];
}

/**
 * Check that `v` is an object (a normalized document or sub-document).
 * @param {unknown} v
 * @param {string} ctx
 * @returns {Record<string, Json>}
 */
export function asObj(v, ctx) {
  if (!isObject(v)) throw new FormatError(`${ctx}: expected a JSON object, got ${typeName(v)}`);
  return /** @type {Record<string, Json>} */ (v);
}

/** @param {Record<string, Json>} o @param {string} key @param {string} ctx */
export function str(o, key, ctx) {
  const v = get(o, key, ctx);
  if (typeof v !== 'string') throw new FormatError(`${ctx}: ${JSON.stringify(key)} must be a string, got ${typeName(v)}`);
  return v;
}

/** Missing key or null gives null. @param {Record<string, Json>} o @param {string} key @param {string} ctx @returns {string | null} */
export function optStr(o, key, ctx) {
  return !Object.hasOwn(o, key) || o[key] === null ? null : str(o, key, ctx);
}

/** @param {Record<string, Json>} o @param {string} key @param {string} ctx */
export function bool(o, key, ctx) {
  const v = get(o, key, ctx);
  if (typeof v !== 'boolean') throw new FormatError(`${ctx}: ${JSON.stringify(key)} must be a boolean, got ${typeName(v)}`);
  return v;
}

/** Missing key or null gives null. @param {Record<string, Json>} o @param {string} key @param {string} ctx @returns {boolean | null} */
export function optBool(o, key, ctx) {
  return !Object.hasOwn(o, key) || o[key] === null ? null : bool(o, key, ctx);
}

/** @param {Record<string, Json>} o @param {string} key @param {string} ctx */
export function int(o, key, ctx) {
  const v = get(o, key, ctx);
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new FormatError(`${ctx}: ${JSON.stringify(key)} must be a safe integer, got ${typeName(v)}${typeof v === 'number' ? ` ${v}` : ''}`);
  }
  return v;
}

/** @param {Record<string, Json>} o @param {string} key @param {string} ctx */
export function obj(o, key, ctx) {
  return asObj(get(o, key, ctx), `${ctx}.${key}`);
}

/** @param {Record<string, Json>} o @param {string} key @param {string} ctx @returns {Json[]} */
export function arr(o, key, ctx) {
  const v = get(o, key, ctx);
  if (!Array.isArray(v)) throw new FormatError(`${ctx}: ${JSON.stringify(key)} must be an array, got ${typeName(v)}`);
  return v;
}

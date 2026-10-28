// @ts-check
/**
 * The values a protocol's printed cards are derived from, as one lookup by source key. Pure.
 *
 * Every card rule names a source key and reads its value as text (lookup tables are keyed by that
 * text, so the forms match the offline analysis exactly):
 *   `alTR[0]`                ASCCONV block 0, raw: quoted values keep their quotes
 *   `pv:sub.0.msr.fat_sat`   a Preview value, as JSON text (`33`, `true`, `"text"`, `2.5`)
 *   `ctrl:Properties.…`      a value of the MultiStep Controller section
 *   `eva:EVA.…`              a value of the XProtocol section before ASCCONV block 0
 *   `seq`                    the sequence's file name, without its folder
 *   `meta:n_asc`             how many ASCCONV blocks the protocol has
 * A key with `[#]` or `.#` stands for a group: both are replaced by the group's index.
 *
 * Preview numbers are JSON text as Python writes it (`1e-05`, not `0.00001`), but the Preview
 * parsed from JSON no longer tells `3.0` from `3`: a whole number is always written without ".0".
 */
import { parseAscconv } from './ascconv.js';
import { controllerAndEva } from './xprotocol.js';

/** @typedef {import('./preview.js').PreviewResult} PreviewResult */
/** @typedef {import('./preview.js').PreviewValue} PreviewValue */
/**
 * `asc`: ASCCONV block 0 (empty when there is none); `nBlocks`: the number of blocks; `pv`: Preview
 * key to value text; `sequence`: `tSequenceFileName` unquoted ("" when absent), e.g.
 * `%SiemensSeq%\tse`; `seq`: its last segment.
 * @typedef {{
 *   asc: ReadonlyMap<string, string>, nBlocks: number, pv: ReadonlyMap<string, string>,
 *   ctrl: ReadonlyMap<string, string>, eva: ReadonlyMap<string, string>, sequence: string, seq: string,
 * }} CardSources
 */

/** A JSON number as Python's `json.dumps` writes it: `repr` of a float, the digits of a whole number. @param {number} x */
function pyNumber(x) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? 'Infinity' : '-Infinity';
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return String(x);
  const [mant, exp] = x.toExponential().split('e'); // shortest digits, as repr
  const e = Number(exp);
  if (e < -4 || e >= 16) {
    const sign = e < 0 ? '-' : '+';
    return `${mant}e${sign}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  return String(x);
}

/** A string as Python's `json.dumps` (ensure_ascii): everything outside space..~ is \uXXXX. @param {string} s */
function pyString(s) {
  return JSON.stringify(s).replace(/[^ -~]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** @param {PreviewValue} v */
function previewText(v) {
  switch (v.kind) {
    case 'number': return pyNumber(v.value);
    case 'bool': return v.value ? 'true' : 'false';
    case 'text': return pyString(v.value);
    case 'code': return String(v.code);
  }
}

/**
 * The sources of a protocol from its text and its Preview. Never throws; what is missing is empty.
 * @param {string} text the protocol text (EdfProtocolContent `Data`)
 * @param {PreviewResult} summary previewOf's result for it
 * @returns {CardSources}
 */
export function cardSources(text, summary) {
  const parsed = parseAscconv(text);
  /** @type {ReadonlyMap<string, string>} */
  const asc = parsed.ok ? parsed.blocks[0] : new Map();
  const nBlocks = parsed.ok ? parsed.blocks.length : 0;
  /** @type {Map<string, string>} */
  const pv = new Map();
  if (summary.ok) {
    for (const item of [...summary.subs.flatMap((s) => s.items), ...summary.controller]) pv.set(item.key, previewText(item.value));
  }
  const { controller, eva } = controllerAndEva(text);
  const sequence = (asc.get('tSequenceFileName') ?? '').replace(/^"+|"+$/g, '');
  return { asc, nBlocks, pv, ctrl: controller, eva, sequence, seq: sequence.slice(sequence.lastIndexOf('\\') + 1) };
}

/**
 * The text of source `key`; for a templated key `group` is the group index. Null when the protocol
 * has no such value, or the key is templated and `group` is null.
 * @param {CardSources} src
 * @param {string} key
 * @param {number | null} [group]
 * @returns {string | null}
 */
export function sourceValue(src, key, group = null) {
  if (key.includes('[#]') || key.includes('.#')) {
    if (group === null) return null;
    key = key.replaceAll('[#]', `[${group}]`).replaceAll('.#', `.${group}`);
  }
  if (key === 'seq') return src.seq;
  if (key === 'meta:n_asc') return String(src.nBlocks);
  if (key.startsWith('pv:')) return src.pv.get(key.slice(3)) ?? null;
  if (key.startsWith('ctrl:')) return src.ctrl.get(key.slice(5)) ?? null;
  if (key.startsWith('eva:')) return src.eva.get(key.slice(4)) ?? null;
  return src.asc.get(key) ?? null;
}

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Source `key` as a number: hex `0x…` as its value, `true`/`false` as 1/0, quotes stripped; null
 * when the value is absent or not a number.
 * @param {CardSources} src
 * @param {string} key
 * @param {number | null} [group]
 * @returns {number | null}
 */
export function sourceNumber(src, key, group = null) {
  const raw = sourceValue(src, key, group);
  if (raw === null) return null;
  const v = raw.replace(/^"+|"+$/g, '');
  if (v === 'true') return 1;
  if (v === 'false') return 0;
  if (/^0x[0-9a-f]+$/i.test(v)) return Number(v);
  return DECIMAL.test(v) ? Number(v) : null;
}

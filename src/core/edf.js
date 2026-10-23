// @ts-check
import { FormatError } from './errors.js';
import { asObj, normalize } from './json.js';

/** @typedef {import('./json.js').Json} Json */

export const INSTANCE_TYPES = /** @type {const} */ ([
  'EdfStructure', 'EdfDirectory', 'EdfProgram', 'EdfString', 'EdfProtocol', 'EdfAddInConfig',
  'EdfMeasurementStep', 'EdfPauseStep', 'EdfInteractionStep', 'EdfDecisionStep', 'EdfWorkflowStep',
  'EdfSplitStep', 'EdfJoinStep',
]);

/** @typedef {typeof INSTANCE_TYPES[number]} InstanceType */

/** @typedef {`${InstanceType}Content`} ContentType */

/**
 * Content type name of an instance type: `<InstanceType>Content`.
 * @param {InstanceType} t
 * @returns {ContentType}
 */
export const contentTypeOf = (t) => `${t}Content`;

const CONTENT_TYPES = new Set(INSTANCE_TYPES.map(contentTypeOf));

/** @param {string} s @returns {s is ContentType} */
const isContentType = (s) => CONTENT_TYPES.has(/** @type {ContentType} */ (s));

const HEADER = /^EDF V1: ContentType=syngo\.MR\.ExamDataFoundation\.Data\.(\w+);\r\n/;
const TAGS = /^(#[^#|]+\|[^#]*)*$/;
const TAG = /#([^#|]+)\|([^#]*)/g;

/**
 * Decode one inflated document: header line, then a JSON object body.
 * Error messages never quote document text (a directory document holds a password).
 * @param {string} text
 * @returns {{ type: ContentType, body: Record<string, Json> }}
 */
export function decodeDoc(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const m = HEADER.exec(text);
  if (m === null) throw new FormatError('EDF header line is missing or malformed');
  const type = m[1];
  if (!isContentType(type)) throw new FormatError(`unknown EDF content type ${JSON.stringify(type)}`);
  let json;
  try {
    json = JSON.parse(text.slice(m[0].length));
  } catch (err) {
    const pos = err instanceof Error ? /position (\d+)/.exec(err.message) : null;
    throw new FormatError(`${type}: invalid JSON${pos ? ` at character ${pos[1]}` : ''}`);
  }
  let body;
  try {
    body = normalize(json);
  } catch (err) {
    if (err instanceof RangeError) throw new FormatError(`${type}: JSON nested too deeply`);
    throw err;
  }
  return { type, body: asObj(body, `${type} body`) };
}

/**
 * Decode inflated bytes as strict UTF-8 and then as a document.
 * @param {Uint8Array} bytes
 */
export function decodeBytes(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new FormatError('document is not valid UTF-8');
  }
  return decodeDoc(text);
}

/**
 * `Instance.Tags`: NULL, empty, or `#Key|Value` repeated with unique keys.
 * A key has no `#` or `|`; a value may contain `|` but not `#`.
 * @param {string | null | undefined} s
 * @param {string} [ctx]
 * @returns {Record<string, string>}
 */
export function parseTags(s, ctx = 'tags') {
  if (!s) return {};
  if (!TAGS.test(s)) throw new FormatError(`${ctx}: malformed tags: ${JSON.stringify(s)}`);
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {[string, string][]} */
  const entries = [];
  for (const [, key, value] of s.matchAll(TAG)) {
    if (seen.has(key)) throw new FormatError(`${ctx}: duplicate tag ${JSON.stringify(key)}`);
    seen.add(key);
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

/**
 * Display text of an EdfString body `{Dates, Texts}`: `Texts.en` if non-empty,
 * else the first non-empty text in file order, else "".
 * @param {Record<string, Json>} body
 * @returns {string}
 */
export function labelText(body) {
  const texts = asObj(body.Texts, 'EdfString Texts');
  /** @type {string[]} */
  const values = [];
  for (const [k, v] of Object.entries(texts)) {
    if (typeof v !== 'string') throw new FormatError(`EdfString Texts[${JSON.stringify(k)}]: expected a string`);
    values.push(v);
  }
  const en = texts.en;
  if (typeof en === 'string' && en) return en;
  return values.find((t) => t) ?? '';
}

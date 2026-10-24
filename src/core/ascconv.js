// @ts-check
/**
 * The ASCCONV blocks of Siemens XProtocol text as raw parameter maps (ported from
 * protocol_tools/compare/ascconv.py). Pure.
 *
 * A block runs from a `### ASCCONV BEGIN … ###` line to a `### ASCCONV END ###` line; a marker
 * counts only at the start of a line. One map per block, in text order (block 0 is the main
 * protocol). Values are raw text: quoted values keep their quotes, unquoted ones lose a trailing
 * `# comment`. The scanner omits default values, so an absent key means "default".
 *
 * Lenient, unlike the Python parser: a bad line is skipped, a duplicate key keeps its last value,
 * and marker mistakes with an obvious reading are taken that way; each is reported as a warning.
 * Only text without any block is an error. Messages never quote document text.
 */

/** @typedef {ReadonlyMap<string, string>} Block */
/** @typedef {{ ok: true, blocks: Block[], warnings: string[] } | { ok: false, error: string }} Ascconv */

// `$` would also match before `\r`, `\u2028` and `\u2029`; Python's matches before `\n` only.
const MARKER = /### ASCCONV (?:BEGIN(?: [^\n]*)?###|END ###)\r?(?=\n|$)/g;
const KEY = /^[A-Za-z0-9_.[\]]+$/;
/** A space or anything Python's `str.isprintable` rejects (other whitespace, controls, unassigned). */
const SPACE_OR_UNPRINTABLE = /[\p{C}\p{Z}]/u;

/**
 * The raw value of `rest` (the text after `=`), or null if malformed.
 * @param {string} rest
 * @returns {string | null}
 */
function parseValue(rest) {
  rest = rest.trim();
  if (rest.startsWith('"')) {
    const close = rest.indexOf('"', 1);
    if (close < 0) return null;
    const tail = rest.slice(close + 1).trim();
    return tail === '' || tail.startsWith('#') ? rest.slice(0, close + 1) : null;
  }
  const value = rest.split('#', 1)[0].trim();
  if (value === '' || SPACE_OR_UNPRINTABLE.test(value) || value.includes('"') || value.includes('=')) return null;
  return value;
}

/**
 * @param {string} body the text between the markers; its first line is the rest of the BEGIN line
 * @param {number} block 1-based, for messages
 * @param {string[]} warnings
 * @returns {Block}
 */
function parseBlock(body, block, warnings) {
  /** @type {Map<string, string>} */
  const params = new Map();
  const lines = body.split('\n');
  for (let number = 1; number < lines.length; number++) {
    const line = lines[number];
    if (line.trim() === '') continue;
    /** @param {string} why */
    const warn = (why) => warnings.push(`ASCCONV block ${block}, line ${number}: ${why}`);
    const eq = line.indexOf('=');
    const key = eq < 0 ? '' : line.slice(0, eq).trim();
    if (!KEY.test(key)) {
      warn('expected KEY = VALUE; line skipped');
      continue;
    }
    const value = parseValue(line.slice(eq + 1));
    if (value === null) {
      warn('malformed value; line skipped');
      continue;
    }
    if (params.has(key)) warn('duplicate key; the last value is kept');
    params.set(key, value);
  }
  return params;
}

/**
 * Parse every ASCCONV block of `text`.
 * @param {string} text
 * @returns {Ascconv}
 */
export function parseAscconv(text) {
  /** @type {Block[]} */
  const blocks = [];
  /** @type {string[]} */
  const warnings = [];
  /** End of the open BEGIN marker, or -1. */
  let begin = -1;
  for (const m of text.matchAll(MARKER)) {
    if (m.index > 0 && text[m.index - 1] !== '\n') continue;
    if (m[0].startsWith('### ASCCONV BEGIN')) {
      if (begin >= 0) {
        warnings.push(`ASCCONV block ${blocks.length + 1} has no END before the next BEGIN; it ends there`);
        blocks.push(parseBlock(text.slice(begin, m.index), blocks.length + 1, warnings));
      }
      begin = m.index + m[0].length;
    } else if (begin < 0) {
      warnings.push(`ASCCONV END without BEGIN after ${blocks.length} block(s); ignored`);
    } else {
      blocks.push(parseBlock(text.slice(begin, m.index), blocks.length + 1, warnings));
      begin = -1;
    }
  }
  if (begin >= 0) {
    warnings.push(`ASCCONV block ${blocks.length + 1} has BEGIN without END; it runs to the end of the text`);
    blocks.push(parseBlock(text.slice(begin), blocks.length + 1, warnings));
  }
  if (blocks.length === 0) return { ok: false, error: 'no ASCCONV block' };
  return { ok: true, blocks, warnings };
}

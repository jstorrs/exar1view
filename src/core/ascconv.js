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
 *
 * `withoutAscconv` gives the rest: the text with the same blocks taken out.
 */

/** @typedef {ReadonlyMap<string, string>} Block */
/** @typedef {{ ok: true, blocks: Block[], warnings: string[] } | { ok: false, error: string }} Ascconv */

// Tried at line starts only, so a long line of repeated BEGINs cannot backtrack quadratically. With
// the `m` flag `^` also matches after `\r`, `\u2028` and `\u2029`, which parseAscconv rules out.
// No `$`: it would match before those too, while Python's matches before `\n` only.
const MARKER = /^### ASCCONV (?:BEGIN(?: [^\n]*)?###|END ###)\r?(?=\n|(?![\s\S]))/gm;
const KEY = /^[A-Za-z0-9_.[\]]+$/;
/** A space or anything Python's `str.isprintable` rejects (other whitespace, controls, unassigned). */
const SPACE_OR_UNPRINTABLE = /[\p{C}\p{Z}]/u;

/** The characters of Python's `str.isspace`: not JS `trim`'s (U+001C-U+001F and U+0085 yes, U+FEFF no). */
const isSpace = (/** @type {string} */ c) => /^[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/.test(c);

/**
 * `s` without leading and trailing whitespace, as Python's `str.strip()`.
 * @param {string} s
 */
export function strip(s) {
  let start = 0;
  let end = s.length;
  while (start < end && isSpace(s[start])) start++;
  while (end > start && isSpace(s[end - 1])) end--;
  return s.slice(start, end);
}

/**
 * The raw value of `rest` (the text after `=`), or null if malformed.
 * @param {string} rest
 * @returns {string | null}
 */
function parseValue(rest) {
  rest = strip(rest);
  if (rest.startsWith('"')) {
    const close = rest.indexOf('"', 1);
    if (close < 0) return null;
    const tail = strip(rest.slice(close + 1));
    return tail === '' || tail.startsWith('#') ? rest.slice(0, close + 1) : null;
  }
  const value = strip(rest.split('#', 1)[0]);
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
    if (strip(line) === '') continue;
    /** @param {string} why */
    const warn = (why) => warnings.push(`ASCCONV block ${block}, line ${number}: ${why}`);
    const eq = line.indexOf('=');
    const key = eq < 0 ? '' : strip(line.slice(0, eq));
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
 * A block's place in the text: from the start of its BEGIN line (`from`) to the end of its END
 * line, before the newline (`to`; the next BEGIN or the end of the text when it has no END), its
 * parameter text running from just after the BEGIN marker (`body`) to `bodyEnd`.
 * @typedef {{ from: number, body: number, bodyEnd: number, to: number }} Span
 */

/**
 * The blocks of `text` in text order, each after any warning about its markers, and the warnings
 * about stray markers where they occur.
 * @param {string} text
 * @returns {Generator<{ warning: string } | { span: Span }>}
 */
function* spans(text) {
  let count = 0;
  /** The open BEGIN marker, or null. @type {{ from: number, body: number } | null} */
  let begin = null;
  for (const m of text.matchAll(MARKER)) {
    if (m.index > 0 && text[m.index - 1] !== '\n') continue;
    if (m[0].startsWith('### ASCCONV BEGIN')) {
      if (begin !== null) {
        yield { warning: `ASCCONV block ${++count} has no END before the next BEGIN; it ends there` };
        yield { span: { ...begin, bodyEnd: m.index, to: m.index } };
      }
      begin = { from: m.index, body: m.index + m[0].length };
    } else if (begin === null) {
      yield { warning: `ASCCONV END without BEGIN after ${count} block(s); ignored` };
    } else {
      count++;
      yield { span: { ...begin, bodyEnd: m.index, to: m.index + m[0].length } };
      begin = null;
    }
  }
  if (begin !== null) {
    yield { warning: `ASCCONV block ${++count} has BEGIN without END; it runs to the end of the text` };
    yield { span: { ...begin, bodyEnd: text.length, to: text.length } };
  }
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
  for (const item of spans(text)) {
    if ('warning' in item) warnings.push(item.warning);
    else blocks.push(parseBlock(text.slice(item.span.body, item.span.bodyEnd), blocks.length + 1, warnings));
  }
  if (blocks.length === 0) return { ok: false, error: 'no ASCCONV block' };
  return { ok: true, blocks, warnings };
}

/**
 * `text` without its ASCCONV blocks (each from its BEGIN line through its END line, as
 * parseAscconv finds them), and without the blank or whitespace-only lines then left at its end
 * (the last remaining line keeps its own trailing spaces): the XProtocol around them.
 * @param {string} text
 */
export function withoutAscconv(text) {
  let out = '';
  let at = 0;
  for (const item of spans(text)) {
    if (!('span' in item)) continue;
    out += text.slice(at, item.span.from);
    at = item.span.to;
    if (text[at] === '\n') at++;
  }
  out += text.slice(at);
  // Back to the last character that is not whitespace, then on over its line's own trailing spaces and tabs.
  let end = out.length;
  while (end > 0 && ' \t\r\n'.includes(out[end - 1])) end--;
  if (end === 0) return '';
  while (end < out.length && ' \t'.includes(out[end])) end++;
  return out.slice(0, end);
}

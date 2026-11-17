// @ts-check
/**
 * Diffusion settings and free vector sets from the main ASCCONV block of a protocol. Pure.
 *
 * The scanner omits default values, so an absent key means 0 (or null where no default is known).
 * Every protocol carries some `sDiffusion.` keys, so only `ulMode` says whether diffusion is on:
 * 1 or absent is none, 128 is Free (vectors stored in `sFreeDiffusionData`), other codes are
 * built in (the scanner computes the vectors). Vector components are sparse: an absent one is 0,
 * and the count comes from `lDiffDirections`, never from the indices present. Multi-shell is
 * encoded in the vector norms: b = bmax * |v|^2. Errors never quote protocol text.
 *
 * The stored comment is read as lines: the first is the source file name, the rest are notes.
 * `builtIn` rests on one observed scanner fallback: when the picked .dvs file had no section for the
 * protocol's direction count, the scanner stored the file name, `SIEMENS` and `Internal N-directions
 * set` and used its own vectors. Then the vectors are the scanner's set, not the named file's. From a
 * multi-section file the scanner stores only the selected section, with the file name as the comment.
 *
 * The scanner applies a .dvs file's normalisation when it loads the file and stores the result with
 * normalisation 1 (none). In a test with xyz files, "unity" and "maximum" both stored every vector
 * scaled to length 1 (maximum scaled each vector separately: lengths 0.5 to 2 all came out 1), and
 * both refused a zero vector. So the stored vectors are what is acquired. Other stored
 * normalisation codes have never been seen; they are refused as a safety net. The scanner accepts
 * xyz components up to 1 each (so an xyz vector may be longer than 1, e.g. (1,1,1); its b is
 * unverified) and prs vectors up to length 1.
 */

/** @typedef {import('./ascconv.js').Block} Block */
/** @typedef {{ code: number, name: string | null }} Mode */
/** @typedef {readonly [number, number, number]} Vector Components dSag, dCor, dTra (x, y, z). */
/** @typedef {{ ok: true, coordinateSystem: 'xyz' | 'prs', normalisation: 'none' } | { ok: false, why: string }} Conventions */
/**
 * @typedef {{
 *   vectors: readonly Vector[],
 *   decimals: number,
 *   coordinateCode: number | null,
 *   normalisationCode: number | null,
 *   conventions: Conventions,
 *   origin: Origin,
 *   comment: string | null,
 * }} VectorSet
 * `decimals` is the most decimals any component needs (at least 1). `comment` is the whole decoded
 * comment ('' without one, null when unreadable): untrusted text, kept only to compare two sets and
 * never shown.
 */
/**
 * @typedef {{ file: string | null, notes: string[], builtIn: boolean }} Origin
 * The comment kept with the table, by line. `file` is the first line, usually the source .dvs file
 * name (possibly a path); `notes` are the other lines (at most 10); `builtIn` says the vectors are
 * the scanner's own set (a note line is `SIEMENS`). All of it is untrusted text: it may contain
 * anything, so sanitize it before use. Without a readable comment: no file, no notes, not built in.
 */
/** @typedef {{ b: number, averages: number | null }} Weighting */
/**
 * @typedef {{ kind: 'none' }
 *   | { kind: 'builtin', mode: Mode, directions: number | null, weightings: Weighting[] }
 *   | { kind: 'free', mode: Mode, set: VectorSet, weightings: Weighting[] }
 *   | { kind: 'invalid', mode: Mode | null, error: string }} Diffusion
 */

const FREE_MODE = 128;
const FREE = 'sDiffusion.sFreeDiffusionData.';
const VECTOR_PREFIX = `${FREE}asDiffDirVector[`;
const COMMENT_PREFIX = `${FREE}sComment`;
const VECTOR_KEY = /^sDiffusion\.sFreeDiffusionData\.asDiffDirVector\[(\d+)\]\.(dSag|dCor|dTra)$/;
const COMMENT_KEY = /^sDiffusion\.sFreeDiffusionData\.sComment(?:\.(\d+)|\[(\d+)\])$/;
/** The largest step in |v|^2 within one shell. */
const SHELL_GAP = 0.002;
const MAX_NOTES = 10;
/** @type {Origin} */
const NO_ORIGIN = { file: null, notes: [], builtIn: false };
const COMPONENTS = /** @type {const} */ (['dSag', 'dCor', 'dTra']);

/** The coordinate system codes seen stored by the scanner. */
export const COORDINATE_NAMES = /** @type {ReadonlyMap<number, 'xyz' | 'prs'>} */ (new Map([[1, 'xyz'], [2, 'prs']]));
/** The normalisation codes seen stored by the scanner (it stores every loaded set as none). */
export const NORMALISATION_NAMES = /** @type {ReadonlyMap<number, 'none'>} */ (new Map([[1, 'none']]));

/** Mode names; the card catalog's "Diffusion mode" lookup (trimmed) is the source, a test keeps them equal. */
export const MODE_NAMES = /** @type {ReadonlyMap<number, string>} */ (new Map([
  [32, 'Phase'], [64, '3-Scan Trace'], [128, 'Free'], [256, 'MDDW'], [1024, '4-Scan Trace'],
]));

/**
 * True for keys of the stored comment.
 * @param {string} key
 */
export function isFreeCommentKey(key) {
  return key.startsWith(COMMENT_PREFIX);
}

/**
 * True for keys of the stored vector table or its comment (the ones a comparison folds).
 * @param {string} key
 */
export function isFreeVectorKey(key) {
  return key.startsWith(VECTOR_PREFIX) || isFreeCommentKey(key);
}

/**
 * An integer, decimal or `0x` hex, or null if malformed.
 * @param {string} raw
 * @returns {number | null}
 */
function parseInteger(raw) {
  if (/^-?\d+$/.test(raw) || /^0[xX][0-9a-fA-F]+$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/**
 * A finite decimal, with or without exponent, or null if malformed.
 * @param {string} raw
 * @returns {number | null}
 */
function parseFloating(raw) {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** @param {number} v */
function decimalsOf(v) {
  for (let d = 0; d <= 100; d++) if (Number(v.toFixed(d)) === v) return d;
  return 100;
}

/**
 * The decimals `v` needs, read from its raw text: the fraction digits without trailing zeros. A
 * plain decimal of at most 15 significant digits is within a tenth of a unit in its last place of its
 * double, so toFixed with that many decimals gives it back and toFixed with fewer gives another such
 * decimal, hence another double: the count equals the search's without calling toFixed (about 1 µs
 * each). Exponent forms, longer texts and more than 100 decimals fall back to the search.
 * @param {string} raw a text parseFloating accepted
 * @param {number} v its value
 */
function decimalsFrom(raw, v) {
  if (raw.includes('e') || raw.includes('E')) return decimalsOf(v);
  const dot = raw.indexOf('.');
  let end = raw.length;
  if (dot >= 0) while (end > dot + 1 && raw.charCodeAt(end - 1) === 48) end--;
  const d = dot < 0 ? 0 : end - dot - 1;
  // Significant digits: every digit from the first non-zero one to `end`, less the dot.
  let first = raw.length;
  for (let k = 0; k < end; k++) {
    const c = raw.charCodeAt(k);
    if (c >= 49 && c <= 57) { first = k; break; }
  }
  const significant = first >= end ? 0 : end - first - (dot > first ? 1 : 0);
  return significant <= 15 && d <= 100 ? d : decimalsOf(v);
}

/**
 * @param {number | null} code
 * @param {number | null} norm
 * @returns {Conventions}
 */
function conventionsOf(code, norm) {
  if (code === null) return { ok: false, why: 'the coordinate system is not stated' };
  if (norm === null) return { ok: false, why: 'the normalisation is not stated' };
  const coordinateSystem = COORDINATE_NAMES.get(code);
  const normalisation = NORMALISATION_NAMES.get(norm);
  if (coordinateSystem === undefined) return { ok: false, why: `coordinate system code ${code} has not been seen; the export would not be reliable` };
  if (normalisation === undefined) return { ok: false, why: `normalisation code ${norm} has not been seen; the export would not be reliable` };
  return { ok: true, coordinateSystem, normalisation };
}

/**
 * A comment byte: 0..255, a signed byte (-128..-1) or a sign-extended 32-bit one (0xffffff80..), as
 * its low 8 bits; null otherwise.
 * @param {string} raw
 * @returns {number | null}
 */
function commentByte(raw) {
  const n = parseInteger(raw);
  if (n === null) return null;
  return (n >= -128 && n <= 255) || (n >= 0xffffff80 && n <= 0xffffffff) ? n & 0xff : null;
}

/**
 * The comment bytes as text (UTF-8): absent bytes are NUL and the text ends at the first NUL; ''
 * without comment bytes, null when a byte or index is malformed.
 * @param {Block} block
 * @returns {string | null}
 */
function commentText(block) {
  /** @type {number[]} */
  const bytes = [];
  for (const [key, raw] of block) {
    const m = COMMENT_KEY.exec(key);
    if (!m) continue;
    const i = Number(m[1] ?? m[2]);
    const byte = commentByte(raw);
    if (byte === null || i > 100_000) return null;
    while (bytes.length <= i) bytes.push(0);
    bytes[i] = byte;
  }
  const nul = bytes.indexOf(0);
  return new TextDecoder().decode(Uint8Array.from(nul < 0 ? bytes : bytes.slice(0, nul)));
}

/**
 * The comment text split on CRLF, LF or CR into trimmed, non-empty lines: the first is the file, at
 * most 10 more are notes. An unreadable comment gives no origin: the comment never blocks the vectors.
 * @param {string | null} text
 * @returns {Origin}
 */
function originOf(text) {
  if (text === null) return NO_ORIGIN;
  const [file = null, ...rest] = text.split(/\r\n|[\n\r]/).map((l) => l.trim()).filter((l) => l !== '');
  const notes = rest.slice(0, MAX_NOTES);
  return { file, notes, builtIn: notes.some((n) => /^siemens$/i.test(n)) };
}

/**
 * The stored table of free mode, or an error message.
 * @param {Block} block
 * @returns {{ ok: true, set: VectorSet } | { ok: false, error: string }}
 */
function parseSet(block) {
  const sizeRaw = block.get(`${FREE}asDiffDirVector.__attribute__.size`);
  const countRaw = block.get('sDiffusion.lDiffDirections');
  const size = sizeRaw === undefined ? 0 : parseInteger(sizeRaw);
  const count = countRaw === undefined ? 0 : parseInteger(countRaw);
  if (size === null || size < 0) return { ok: false, error: 'the vector table size is malformed' };
  if (count === null || count < 0) return { ok: false, error: 'the number of directions is malformed' };
  if (size !== count) return { ok: false, error: 'the vector table size differs from the number of directions' };
  if (count > 100_000) return { ok: false, error: 'the number of directions is out of range' };

  /** @type {[number, number, number][]} */
  const vectors = Array.from({ length: count }, () => [0, 0, 0]);
  let decimals = 1;
  for (const [key, raw] of block) {
    // The full pattern first: startsWith alone costs about as much per key, and most keys match.
    const m = VECTOR_KEY.exec(key);
    if (!m) {
      if (key.startsWith(VECTOR_PREFIX)) return { ok: false, error: 'a vector key is not recognised' };
      continue;
    }
    const i = Number(m[1]);
    if (i >= count) return { ok: false, error: `vector ${i} lies beyond the ${count} directions` };
    const v = parseFloating(raw);
    if (v === null) return { ok: false, error: `vector ${i} has a malformed ${m[2]}` };
    vectors[i][COMPONENTS.indexOf(/** @type {'dSag' | 'dCor' | 'dTra'} */ (m[2]))] = v;
    decimals = Math.max(decimals, decimalsFrom(raw, v));
  }

  /** @type {(number | null)[]} */
  const codes = [];
  for (const name of ['ulCoordinateSystem', 'ulNormalization']) {
    const raw = block.get(FREE + name);
    const code = raw === undefined ? null : parseInteger(raw);
    if (raw !== undefined && code === null) return { ok: false, error: `${name} is malformed` };
    codes.push(code);
  }
  const [coordinateCode, normalisationCode] = codes;
  const comment = commentText(block);
  return {
    ok: true,
    set: {
      vectors, decimals, coordinateCode, normalisationCode, conventions: conventionsOf(coordinateCode, normalisationCode),
      origin: originOf(comment), comment,
    },
  };
}

/**
 * The b-value table, or an error message.
 * @param {Block} block
 * @returns {{ ok: true, weightings: Weighting[] } | { ok: false, error: string }}
 */
function parseWeightings(block) {
  const countRaw = block.get('sDiffusion.lDiffWeightings');
  const count = countRaw === undefined ? 0 : parseInteger(countRaw);
  if (count === null || count < 0 || count > 1000) return { ok: false, error: 'the number of weightings is malformed' };
  /** @type {Weighting[]} */
  const weightings = [];
  for (let i = 0; i < count; i++) {
    const bRaw = block.get(`sDiffusion.alBValue[${i}]`);
    const aRaw = block.get(`sDiffusion.alAverages[${i}]`);
    const b = bRaw === undefined ? 0 : parseInteger(bRaw);
    const averages = aRaw === undefined ? null : parseInteger(aRaw);
    if (b === null) return { ok: false, error: `weighting ${i} has a malformed b-value` };
    if (aRaw !== undefined && averages === null) return { ok: false, error: `weighting ${i} has malformed averages` };
    weightings.push({ b, averages });
  }
  return { ok: true, weightings };
}

/**
 * The diffusion settings of the main block.
 * @param {Block} block
 * @returns {Diffusion}
 */
export function diffusionOf(block) {
  const modeRaw = block.get('sDiffusion.ulMode');
  const code = modeRaw === undefined ? 1 : parseInteger(modeRaw);
  if (code === null || code < 0) return { kind: 'invalid', mode: null, error: 'the diffusion mode is malformed' };
  if (code === 1) return { kind: 'none' };
  const mode = { code, name: MODE_NAMES.get(code) ?? null };
  /**
   * @param {string} error
   * @returns {Diffusion}
   */
  const invalid = (error) => ({ kind: 'invalid', mode, error });

  const w = parseWeightings(block);
  if (!w.ok) return invalid(w.error);
  if (code === FREE_MODE) {
    const s = parseSet(block);
    if (!s.ok) return invalid(s.error);
    return s.set.vectors.length === 0 ? invalid('free mode has no vectors') : { kind: 'free', mode, set: s.set, weightings: w.weightings };
  }
  // Built-in modes: lDiffDirections is the mode's own count; any stored table is ignored.
  const dirRaw = block.get('sDiffusion.lDiffDirections');
  const directions = dirRaw === undefined ? null : parseInteger(dirRaw);
  if (dirRaw !== undefined && (directions === null || directions < 0)) return invalid('the number of directions is malformed');
  return { kind: 'builtin', mode, directions, weightings: w.weightings };
}

/**
 * The vectors grouped into shells by squared length, ascending: a new shell starts where |v|^2
 * jumps by more than 0.002 (about 6 s/mm^2 at bmax 3000; 3-decimal files spread about 0.001 within
 * a shell). `fraction` is the shell's mean |v|^2 (2 decimals), `b` is bmax times that mean rounded
 * to an integer, or null without a positive `bmax`; `count` is the number of vectors.
 * @param {VectorSet} set
 * @param {number | null} bmax
 * @returns {{ b: number | null, fraction: number, count: number }[]}
 */
export function shells(set, bmax) {
  const norms = set.vectors.map(([x, y, z]) => x * x + y * y + z * z).sort((a, b) => a - b);
  /** @type {number[][]} */
  const groups = [];
  for (const n2 of norms) {
    const last = groups[groups.length - 1];
    if (last && n2 - last[last.length - 1] <= SHELL_GAP) last.push(n2);
    else groups.push([n2]);
  }
  return groups.map((g) => {
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    return {
      b: bmax !== null && bmax > 0 ? Math.round(bmax * mean) : null,
      fraction: Math.round(mean * 100) / 100,
      count: g.length,
    };
  });
}

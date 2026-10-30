// @ts-check
/**
 * Parse a protocol's UpgradeInfo note into its conversions and the parameter changes each made, with a
 * canonical text per change so identical changes written with different spacing group together. Pure.
 */

/**
 * `text` is the canonical `Parameter: from --> to unit` and is the grouping key; `from` may be ''.
 * @typedef {{ parameter: string, from: string, to: string, unit: string, text: string }} ParamChange
 */
/** A line that is not a change; `text` is the whitespace-collapsed line and is the grouping key. @typedef {{ parameter: null, text: string }} OtherLine */
/** @typedef {ParamChange | OtherLine} Change */
/** `date` is kept as written, null for text before the first header. @typedef {{ date: string | null, changes: Change[] }} Conversion */

const HEADER = /Protocol was converted on\s+(\S+?)\s*:/g;
const CHANGE = /^(.+?):\s*(.*?)\s*-->\s*(.*)$/;
const UNIT = /^(.*\S)\s{2,}(\S+)$/;
const PLAIN_NUMBER = /^[-+]?\d+(?:\.\d+)?$/;

/** @param {string} s */
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/** @param {string} line a trimmed, non-blank line @returns {Change} */
function parseLine(line) {
  const m = CHANGE.exec(line);
  if (!m) return { parameter: null, text: collapse(line) };
  const toPart = m[3];
  const u = UNIT.exec(toPart);
  const hasUnit = u !== null && !PLAIN_NUMBER.test(u[2]);
  const parameter = collapse(m[1]);
  const from = collapse(m[2]);
  const to = collapse(hasUnit ? u[1] : toPart);
  const unit = hasUnit ? collapse(u[2]) : '';
  const text = `${parameter}:${from ? ` ${from}` : ''} --> ${to}${unit ? ` ${unit}` : ''}`;
  return { parameter, from, to, unit, text };
}

/** @param {string} block @returns {Change[]} */
function parseBlock(block) {
  return block.split('\n').map((l) => l.trim()).filter((l) => l !== '').map(parseLine);
}

/**
 * Conversions in first-appearance order; those with the same date merge and their changes dedupe by `text`.
 * @param {string} text
 * @returns {Conversion[]}
 */
export function parseNotes(text) {
  /** @type {{ date: string | null, block: string }[]} */
  const blocks = [];
  const headers = [...text.matchAll(HEADER)];
  const preamble = text.slice(0, headers.length ? headers[0].index : text.length);
  if (preamble.trim() !== '') blocks.push({ date: null, block: preamble });
  headers.forEach((h, i) => {
    const start = h.index + h[0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index : text.length;
    blocks.push({ date: h[1], block: text.slice(start, end) });
  });

  /** @type {Map<string | null, Conversion>} */
  const byDate = new Map();
  for (const { date, block } of blocks) {
    let conv = byDate.get(date);
    if (!conv) byDate.set(date, (conv = { date, changes: [] }));
    for (const c of parseBlock(block)) {
      if (!conv.changes.some((x) => x.text === c.text)) conv.changes.push(c);
    }
  }
  return [...byDate.values()];
}

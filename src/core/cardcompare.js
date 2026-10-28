// @ts-check
/**
 * Two protocols' cards side by side for the compare panel: the header fields, then each tab's
 * cards, with the lines of both sides aligned by group and label into Label | A | B rows, a
 * label filter that hides lines with the same value unless asked for, and the status line. Pure.
 */
import { mergeOrder } from './mergeorder.js';
import { headerFields } from './cardformulas.js';

/** @typedef {import('./cards.js').Cards} Cards */
/** @typedef {import('./cards.js').CardLine} CardLine */

/**
 * One side's value: `raw` when the catalog has no entry for it (shown as stored); `flag` when its
 * label was printed with the "! " mark.
 * @typedef {{ text: string, raw: boolean, flag: boolean }} CardCell
 */
/** A null side has no such line. @typedef {{ label: string, a: CardCell | null, b: CardCell | null, same: boolean }} CardRow */
/** @typedef {{ tab: string, cards: { name: string, rows: CardRow[] }[] }[]} CardTabs */
/** `differ` counts the rows not `same`. @typedef {{ header: CardRow[], tabs: CardTabs, differ: number }} CardComparison */

/** @param {string} s */
const parts = (s) => s.replace(/\s+/g, ' ').trim().split(/(\d+(?:\.\d+)?)/);

/**
 * Whether two values read the same: whitespace collapsed and trimmed, numbers compared as numbers
 * ("3.0 mm" and "3 mm"), the text around them exactly.
 * @param {string} x
 * @param {string} y
 */
export function sameValue(x, y) {
  const [p, q] = [parts(x), parts(y)];
  // split with a capture group puts the numbers at the odd indices
  return p.length === q.length && p.every((s, i) => (i % 2 === 0 ? s === q[i] : Number(s) === Number(q[i])));
}

/**
 * Rows in the order merged from both sides' keys.
 * @param {[string, string, CardCell][]} a key, label, cell
 * @param {[string, string, CardCell][]} b
 * @returns {CardRow[]}
 */
function rowsOf(a, b) {
  const [ma, mb] = [new Map(a.map(([k, , c]) => [k, c])), new Map(b.map(([k, , c]) => [k, c]))];
  const labels = new Map([...a, ...b].map(([k, l]) => [k, l]));
  return mergeOrder([a.map(([k]) => k), b.map(([k]) => k)]).order.map((k) => {
    const [x, y] = [ma.get(k) ?? null, mb.get(k) ?? null];
    const same = x !== null && y !== null && x.flag === y.flag && sameValue(x.text, y.text);
    return { label: /** @type {string} */ (labels.get(k)), a: x, b: y, same };
  });
}

/** @param {Cards} c @returns {[string, string, CardCell][]} */
const headerCells = (c) => headerFields(c.header).map(([label, text]) => {
  const l = label ?? 'Sequence';
  return [l, l, { text, raw: false, flag: false }];
});

/**
 * A card's lines keyed by group, bare label and occurrence, so a repeated label pairs in order.
 * @param {readonly CardLine[]} lines
 * @returns {[string, string, CardCell][]}
 */
function lineCells(lines) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return lines.map((l) => {
    const bare = l.label.replace(/^(! | {2})/, '');
    const pair = `${l.group ?? ''}\u001f${bare}`;
    const k = seen.get(pair) ?? 0;
    seen.set(pair, k + 1);
    return [`${pair}\u001f${k}`, bare, { text: l.text, raw: l.status === 'raw', flag: l.label.startsWith('! ') }];
  });
}

/**
 * The comparison of `a` and `b`: header rows, then tabs and cards in the order merged from both
 * sides. A card with no line on either side is left out, as is a tab left empty.
 * @param {Cards} a
 * @param {Cards} b
 * @returns {CardComparison}
 */
export function compareCards(a, b) {
  const header = rowsOf(headerCells(a), headerCells(b));
  const tabOf = (/** @type {Cards} */ c, /** @type {string} */ tab) => c.tabs.find((t) => t.tab === tab)?.cards ?? [];
  const tabs = mergeOrder([a.tabs.map((t) => t.tab), b.tabs.map((t) => t.tab)]).order.map((tab) => {
    const [ca, cb] = [tabOf(a, tab), tabOf(b, tab)];
    const linesOf = (/** @type {typeof ca} */ cs, /** @type {string} */ name) => cs.find((c) => c.name === name)?.lines ?? [];
    const cards = mergeOrder([ca.map((c) => c.name), cb.map((c) => c.name)]).order
      .map((name) => ({ name, rows: rowsOf(lineCells(linesOf(ca, name)), lineCells(linesOf(cb, name))) }))
      .filter((c) => c.rows.length > 0);
    return { tab, cards };
  }).filter((t) => t.cards.length > 0);
  const rows = [...header, ...tabs.flatMap((t) => t.cards.flatMap((c) => c.rows))];
  return { header, tabs, differ: rows.filter((r) => !r.same).length };
}

/**
 * The status line.
 * @param {number} differ
 */
export function cardStatus(differ) {
  if (differ === 0) return 'No card line differs';
  return differ === 1 ? '1 card line differs' : `${differ} card lines differ`;
}

/**
 * The rows shown: those that differ (all with `showAll`) whose label contains `query` (ignoring
 * case), cards and tabs left empty dropped. `empty` says why nothing is shown (null when
 * something is): no card applies to either protocol (no tab on either side; the header fields
 * alone do not count), then the filter matches nothing, then nothing differs.
 * @param {CardComparison} c
 * @param {{ query: string, showAll: boolean }} opts
 * @returns {{ header: CardRow[], tabs: CardTabs, empty: string | null }}
 */
export function cardRows(c, { query, showAll }) {
  const q = query.trim().toLowerCase();
  const keep = (/** @type {CardRow[]} */ rows) => rows.filter((r) => (showAll || !r.same) && r.label.toLowerCase().includes(q));
  const header = keep(c.header);
  const tabs = c.tabs
    .map((t) => ({ tab: t.tab, cards: t.cards.map((d) => ({ name: d.name, rows: keep(d.rows) })).filter((d) => d.rows.length > 0) }))
    .filter((t) => t.cards.length > 0);
  /** @type {string | null} */
  let empty = null;
  if (header.length === 0 && tabs.length === 0) {
    if (c.tabs.length === 0) empty = 'No card of the catalog applies to either protocol';
    else if (q !== '') empty = showAll ? 'No line matches the filter' : 'No differing line matches the filter';
    else empty = 'No card line differs';
  }
  return { header, tabs, empty };
}

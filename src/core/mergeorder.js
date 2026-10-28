// @ts-check
/** Merge ordered sequences of names into one order consistent with all of them. Pure. */

/**
 * One order consistent with every sequence (each a subsequence of it), ties broken by earliest
 * position in any sequence, then first appearance. On a cycle the waiting node with the earliest
 * position is placed anyway; `broken` counts those placements.
 * @param {Iterable<string[]>} sequences
 * @returns {{ order: string[], broken: number }}
 */
export function mergeOrder(sequences) {
  /** @type {Map<string, Set<string>>} */
  const succ = new Map();
  /** @type {Map<string, number>} position: earliest index, then first appearance */
  const firstPos = new Map();
  /** @type {Map<string, number>} */
  const seenAt = new Map();
  for (const s of sequences) {
    s.forEach((x, i) => {
      if (!seenAt.has(x)) seenAt.set(x, seenAt.size);
      firstPos.set(x, Math.min(firstPos.get(x) ?? Infinity, i));
      if (!succ.has(x)) succ.set(x, new Set());
      if (i > 0) /** @type {Set<string>} */ (succ.get(s[i - 1])).add(x);
    });
  }
  /** @type {Map<string, number>} */
  const indeg = new Map([...succ.keys()].map((x) => [x, 0]));
  for (const bs of succ.values()) for (const b of bs) indeg.set(b, /** @type {number} */ (indeg.get(b)) + 1);
  /** @param {string} a @param {string} b */
  const before = (a, b) => /** @type {number} */ (firstPos.get(a)) - /** @type {number} */ (firstPos.get(b))
    || /** @type {number} */ (seenAt.get(a)) - /** @type {number} */ (seenAt.get(b));
  const waiting = new Set(succ.keys());
  /** @type {string[]} */
  const order = [];
  let broken = 0;
  while (waiting.size) {
    let next = null;
    for (const x of waiting) if (indeg.get(x) === 0 && (next === null || before(x, next) < 0)) next = x;
    if (next === null) {
      broken++;
      for (const x of waiting) if (next === null || before(x, next) < 0) next = x;
    }
    const x = /** @type {string} */ (next);
    waiting.delete(x);
    order.push(x);
    for (const b of /** @type {Set<string>} */ (succ.get(x))) indeg.set(b, /** @type {number} */ (indeg.get(b)) - 1);
  }
  return { order, broken };
}

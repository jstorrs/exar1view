// @ts-check
/**
 * Structural comparison of two programs (possibly from different files): steps, decisions and
 * branches, aligned level by level. Protocol parameters are not parsed; a Measurement's protocol
 * is only same / differs / missing by content hash. Pure.
 */
import { stepFacts, copyRefIndex } from './stepinfo.js';

/** @typedef {import('./model.js').Program} Program */
/** @typedef {import('./model.js').Step} Step */
/** @typedef {import('./model.js').Branch} Branch */
/** @typedef {import('./model.js').BodyNode} BodyNode */
/** @typedef {Extract<BodyNode, { type: 'fork' }>} ForkNode */
/** @typedef {import('./stepinfo.js').Fact} Fact */
/** One differing field; null: not set on that side. @typedef {{ field: string, a: string | null, b: string | null }} FieldDiff */

/**
 * A thing on both sides (with its field differences) or on one side only.
 * @template T
 * @typedef {{ in: 'both', a: T, b: T, diffs: FieldDiff[] } | { in: 'a', a: T } | { in: 'b', b: T }} Paired
 */

/** @typedef {'same' | 'differs' | 'missing'} ProtocolCmp */

/**
 * A one-sided step that is also one-sided, with the same kind and label, on the other side: a
 * move. Both nodes of the pair carry the same `id` and the same `diffs` (A's value, B's value)
 * and `protocol` as if they had been matched.
 * @typedef {{ id: number, diffs: FieldDiff[], protocol?: ProtocolCmp }} Moved
 */

/**
 * A body node of the comparison. A fork carries its branches, one-sided throughout when the
 * fork itself is one-sided. `moved` is set only on a one-sided step.
 * @typedef {({ type: 'step', protocol?: ProtocolCmp, moved?: Moved } & Paired<Step>)
 *   | ({ type: 'fork', branches: BranchCmp[] } & Paired<ForkNode>)} NodeCmp
 */
/** A branch with its compared body (one-sided nodes when the branch is). @typedef {Paired<Branch> & { body: NodeCmp[] }} BranchCmp */
/** @typedef {{ header: FieldDiff[], body: NodeCmp[] }} ProgramCmp */

/** The programs and their copy references. @typedef {{ a: Program, b: Program, ia: CopyIndex, ib: CopyIndex }} Ctx */
/** @typedef {ReturnType<typeof copyRefIndex>} CopyIndex */

/**
 * Longest common subsequence of two key lists as index pairs, earliest matches first. A null
 * key never matches. A common prefix is trimmed before the quadratic table.
 * @param {readonly (string | null)[]} a
 * @param {readonly (string | null)[]} b
 * @returns {[number, number][]}
 */
export function lcs(a, b) {
  /** @param {number} i @param {number} j */
  const eq = (i, j) => a[i] !== null && a[i] === b[j];
  let lo = 0;
  while (lo < a.length && lo < b.length && eq(lo, lo)) lo++;
  const ea = a.length;
  const eb = b.length;
  /** @type {[number, number][]} */
  const out = [];
  for (let i = 0; i < lo; i++) out.push([i, i]);

  // t[i][j]: LCS length of a[i..ea) and b[j..eb), flat with row stride w.
  const w = eb - lo + 1;
  const t = new Uint32Array((ea - lo + 1) * w);
  /** @param {number} i @param {number} j */
  const at = (i, j) => (i - lo) * w + (j - lo);
  for (let i = ea - 1; i >= lo; i--) {
    for (let j = eb - 1; j >= lo; j--) {
      t[at(i, j)] = eq(i, j) ? t[at(i + 1, j + 1)] + 1 : Math.max(t[at(i + 1, j)], t[at(i, j + 1)]);
    }
  }
  let i = lo;
  let j = lo;
  while (i < ea && j < eb) {
    if (eq(i, j) && t[at(i, j)] === t[at(i + 1, j + 1)] + 1) {
      out.push([i++, j++]);
    } else if (t[at(i + 1, j)] === t[at(i, j)]) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

/**
 * Fields that differ between two fact lists, paired by label (A's labels, then B-only ones).
 * @param {readonly Fact[]} fa
 * @param {readonly Fact[]} fb
 * @returns {FieldDiff[]}
 */
export function diffFacts(fa, fb) {
  const va = new Map(fa.map((f) => [f.label, f.value]));
  const vb = new Map(fb.map((f) => [f.label, f.value]));
  return [...new Set([...va.keys(), ...vb.keys()])].flatMap((field) => {
    const a = va.get(field) ?? null;
    const b = vb.get(field) ?? null;
    return a === b ? [] : [{ field, a, b }];
  });
}

const HIDDEN = new Set(['Kind', 'Label', 'Rank']);

/** @param {Record<string, string>} tags @returns {Fact[]} */
const tagFacts = (tags) => Object.entries(tags).map(([name, value]) => ({ label: `Tag ${name}`, value }));

/**
 * Copy references of a step as facts: the label names direction, other step and group (repeats
 * numbered), the value the options set.
 * @param {Step} s @param {CopyIndex} index @returns {Fact[]}
 */
function copyFacts(s, index) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return (index.get(s.ids.object) ?? []).map((r) => {
    const base = `${r.direction === 'to' ? 'Copies to' : 'Copied from'} ${r.other} (${r.group})`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { label: n === 1 ? base : `${base} #${n}`, value: [...r.flags, ...(r.broken ? ['broken'] : [])].join(', ') };
  });
}

/** The facts a step pair is compared on: no kind, label or rank, plus its tags and copy references. @param {Step} s @param {Program} p @param {CopyIndex} index @returns {Fact[]} */
const compareFacts = (s, p, index) => [...stepFacts(s, p).filter((f) => !HIDDEN.has(f.label)), ...tagFacts(s.tags), ...copyFacts(s, index)];

/** The field of an add-in whose content (a hash) differs; its values are not meant to be shown. */
export const ADD_IN_CONTENT = 'Add-in content';

/** @param {Step} s @returns {string | null} */
const addInBlob = (s) => ('addInBlob' in s.detail ? s.detail.addInBlob : null);

/** @param {Step} st */
const stepKey = (st) => `${st.kind}\0${st.label}`;

/** @param {BodyNode} n */
const strongKey = (n) => (n.type === 'step' ? stepKey(n.step) : `F\0${n.condition.kind}\0${n.condition.label}`);

/** The key of a rename: the same protocol, or the same condition kind and choices. @param {BodyNode} n @returns {string | null} */
function weakKey(n) {
  if (n.type === 'fork') return n.condition.choices.length === 0 ? null : `F\0${n.condition.kind}\0${n.condition.choices.map((c) => c.label).join('\0')}`;
  const blob = n.step.kind === 'Measurement' ? n.step.detail.protocolBlob : null;
  return blob === null ? null : `M\0${blob}`;
}

/**
 * The elements of A and B with their `pairs` (index pairs, ascending) interleaved: `gap` turns
 * the unpaired runs between pairs into output, `match` a pair.
 * @template X, O
 * @param {readonly X[]} a
 * @param {readonly X[]} b
 * @param {readonly [number, number][]} pairs
 * @param {(ga: X[], gb: X[]) => O[]} gap
 * @param {(x: X, y: X) => O} match
 * @returns {O[]}
 */
function zip(a, b, pairs, gap, match) {
  /** @type {O[]} */
  const out = [];
  let i = 0;
  let j = 0;
  for (const [mi, mj] of pairs) {
    out.push(...gap(a.slice(i, mi), b.slice(j, mj)), match(a[mi], b[mj]));
    i = mi + 1;
    j = mj + 1;
  }
  out.push(...gap(a.slice(i), b.slice(j)));
  return out;
}

/** A node on one side only, its subtree one-sided too. @param {'a' | 'b'} side @param {BodyNode} node @returns {NodeCmp} */
function oneSided(side, node) {
  if (node.type === 'step') return side === 'a' ? { type: 'step', in: 'a', a: node.step } : { type: 'step', in: 'b', b: node.step };
  const branches = node.branches.map((br) => oneBranch(side, br));
  return side === 'a' ? { type: 'fork', in: 'a', a: node, branches } : { type: 'fork', in: 'b', b: node, branches };
}

/** @param {'a' | 'b'} side @param {Branch} br @returns {BranchCmp} */
function oneBranch(side, br) {
  const body = br.body.map((n) => oneSided(side, n));
  return side === 'a' ? { in: 'a', a: br, body } : { in: 'b', b: br, body };
}

/**
 * Compare two bodies: strong matches (same kind and label, same condition), then renames inside
 * each gap (same protocol, same choices), the rest one-sided.
 * @param {readonly BodyNode[]} a
 * @param {readonly BodyNode[]} b
 * @param {Ctx} ctx
 * @returns {NodeCmp[]}
 */
function compareBodies(a, b, ctx) {
  const weak = (/** @type {BodyNode[]} */ ga, /** @type {BodyNode[]} */ gb) => zip(ga, gb, lcs(ga.map(weakKey), gb.map(weakKey)),
    (xs, ys) => [...xs.map((n) => oneSided('a', n)), ...ys.map((n) => oneSided('b', n))],
    (x, y) => compareNodes(x, y, true, ctx));
  return zip(a, b, lcs(a.map(strongKey), b.map(strongKey)), weak, (x, y) => compareNodes(x, y, false, ctx));
}

/**
 * @param {BodyNode} na
 * @param {BodyNode} nb
 * @param {boolean} renamed matched by the weak key
 * @param {Ctx} ctx
 * @returns {NodeCmp}
 */
function compareNodes(na, nb, renamed, ctx) {
  if (na.type === 'step' && nb.type === 'step') return compareSteps(na.step, nb.step, renamed, ctx);
  if (na.type === 'fork' && nb.type === 'fork') return compareForks(na, nb, ctx);
  throw new Error('internal: a step was matched with a fork');
}

/** @param {Step} sa @param {Step} sb @param {boolean} renamed @param {Ctx} ctx @returns {NodeCmp} */
function compareSteps(sa, sb, renamed, ctx) {
  const diffs = diffFacts(compareFacts(sa, ctx.a, ctx.ia), compareFacts(sb, ctx.b, ctx.ib));
  if (renamed) diffs.unshift({ field: 'Label', a: sa.label, b: sb.label });
  const [xa, xb] = [addInBlob(sa), addInBlob(sb)];
  if (xa !== null && xb !== null && xa !== xb) diffs.push({ field: ADD_IN_CONTENT, a: xa, b: xb });
  /** @type {{ protocol?: ProtocolCmp }} */
  let extra = {};
  if (sa.kind === 'Measurement' && sb.kind === 'Measurement') {
    const [pa, pb] = [sa.detail.protocolBlob, sb.detail.protocolBlob];
    extra = { protocol: pa === null && pb === null ? 'missing' : pa === pb ? 'same' : 'differs' };
  }
  return { type: 'step', in: 'both', a: sa, b: sb, diffs, ...extra };
}

/** @param {string} field @param {Step} x @param {Step} y @returns {FieldDiff[]} */
const labelDiff = (field, x, y) => (x.label === y.label ? [] : [{ field, a: x.label, b: y.label }]);

/** @param {boolean} on @returns {string} */
const yesNo = (on) => (on ? 'yes' : 'no');

/** @param {ForkNode} fa @param {ForkNode} fb @param {Ctx} ctx @returns {NodeCmp} */
function compareForks(fa, fb, ctx) {
  /** @param {string} prefix @param {Fact[]} facts @returns {Fact[]} */
  const named = (prefix, facts) => facts.map((f) => ({ label: `${prefix}${f.label}`, value: f.value }));
  const join = (/** @type {ForkNode} */ f) => named('Join ', [{ label: 'Comment', value: f.join.comment }, ...tagFacts(f.join.tags)]);
  const diffs = [
    ...labelDiff('Label', fa.split, fb.split),
    ...diffFacts(compareFacts(fa.split, ctx.a, ctx.ia), compareFacts(fb.split, ctx.b, ctx.ib)),
    ...labelDiff('Join Label', fa.join, fb.join),
    ...diffFacts(join(fa), join(fb)),
  ];

  // Branches pair by choice label (duplicates in order); A's order, then B-only ones.
  const rest = [...fb.branches];
  /** @type {BranchCmp[]} */
  const branches = fa.branches.map((ba) => {
    const k = rest.findIndex((bb) => bb.choice.label === ba.choice.label);
    if (k < 0) return oneBranch('a', ba);
    const [bb] = rest.splice(k, 1);
    return {
      in: 'both', a: ba, b: bb,
      diffs: ba.isDefault === bb.isDefault ? [] : [{ field: 'Default', a: yesNo(ba.isDefault), b: yesNo(bb.isDefault) }],
      body: compareBodies(ba.body, bb.body, ctx),
    };
  });
  branches.push(...rest.map((bb) => oneBranch('b', bb)));
  return { type: 'fork', in: 'both', a: fa, b: fb, diffs, branches };
}

/**
 * Pair the one-sided steps of A with those of B anywhere in the comparison by strong key (kind
 * and label), in pre-order, duplicates in order. Returns the body with each paired step marked
 * `moved`; nothing else changes.
 * @param {readonly NodeCmp[]} body
 * @param {Ctx} ctx
 * @returns {NodeCmp[]}
 */
function markMoved(body, ctx) {
  /** @type {Map<string, Extract<NodeCmp, { type: 'step', in: 'a' }>[]>} */
  const lonelyA = new Map();
  /** @type {Extract<NodeCmp, { type: 'step', in: 'b' }>[]} */
  const lonelyB = [];
  // With rank order a fork's Split and Join are plain steps; they belong to their fork.
  const forkEnd = (/** @type {Step} */ st) => st.kind === 'Split' || st.kind === 'Join';
  /** @param {readonly NodeCmp[]} nodes */
  const collect = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'fork') n.branches.forEach((br) => collect(br.body));
      else if (n.in === 'a' && !forkEnd(n.a)) lonelyA.set(stepKey(n.a), [...(lonelyA.get(stepKey(n.a)) ?? []), n]);
      else if (n.in === 'b' && !forkEnd(n.b)) lonelyB.push(n);
    }
  };
  collect(body);

  /** @type {Map<NodeCmp, Moved>} */
  const moves = new Map();
  let nextId = 0;
  for (const nb of lonelyB) {
    const na = lonelyA.get(stepKey(nb.b))?.shift();
    if (!na) continue;
    const { diffs, protocol } = /** @type {Extract<NodeCmp, { type: 'step', in: 'both' }>} */ (compareSteps(na.a, nb.b, false, ctx));
    const moved = { id: nextId++, diffs, ...(protocol ? { protocol } : {}) };
    moves.set(na, moved);
    moves.set(nb, moved);
  }
  if (moves.size === 0) return [...body];

  /** @param {readonly NodeCmp[]} nodes @returns {NodeCmp[]} */
  const apply = (nodes) => nodes.map((n) => {
    if (n.type === 'fork') return { ...n, branches: n.branches.map((br) => ({ ...br, body: apply(br.body) })) };
    const moved = moves.get(n);
    return moved ? { ...n, moved } : n;
  });
  return apply(body);
}

/**
 * Compare program A with program B.
 * @param {Program} a
 * @param {Program} b
 * @returns {ProgramCmp}
 */
export function comparePrograms(a, b) {
  /** @param {Program} p @returns {Fact[]} */
  const header = (p) => [{ label: 'Comment', value: p.comment }, ...tagFacts(p.tags)];
  const ctx = { a, b, ia: copyRefIndex(a), ib: copyRefIndex(b) };
  return { header: diffFacts(header(a), header(b)), body: markMoved(compareBodies(a.body, b.body, ctx), ctx) };
}

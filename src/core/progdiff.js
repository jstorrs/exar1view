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
 * A body node of the comparison. A fork carries its branches, one-sided throughout when the
 * fork itself is one-sided.
 * @typedef {({ type: 'step', protocol?: ProtocolCmp } & Paired<Step>)
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

/** @param {Step} s @returns {string | null} */
const addInBlob = (s) => ('addInBlob' in s.detail ? s.detail.addInBlob : null);

/** @param {BodyNode} n */
const strongKey = (n) => (n.type === 'step' ? `${n.step.kind}\0${n.step.label}` : `F\0${n.condition.kind}\0${n.condition.label}`);

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
  if (xa !== null && xb !== null && xa !== xb) diffs.push({ field: 'Add-in', a: xa, b: xb });
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
 * Compare program A with program B.
 * @param {Program} a
 * @param {Program} b
 * @returns {ProgramCmp}
 */
export function comparePrograms(a, b) {
  /** @param {Program} p @returns {Fact[]} */
  const header = (p) => [{ label: 'Comment', value: p.comment }, ...tagFacts(p.tags)];
  return { header: diffFacts(header(a), header(b)), body: compareBodies(a.body, b.body, { a, b, ia: copyRefIndex(a), ib: copyRefIndex(b) }) };
}

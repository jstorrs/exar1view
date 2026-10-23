// @ts-check
/**
 * Tiny element builder. Everything goes through createElement / setAttribute /
 * createTextNode, so data can never be interpreted as markup.
 */
import { visibleControls } from '../core/visible.js';
import { splitWhitespace } from '../core/treeview.js';

/** @typedef {string | number | Node | null | undefined | false} ChildLeaf */
/** @typedef {ChildLeaf | readonly ChildLeaf[]} Child */

/**
 * Attribute rules:
 *  - `class`: className string
 *  - `onClick` etc: addEventListener('click', fn)
 *  - `dataset`: object copied onto element.dataset
 *  - `aria-*`: always stringified (so `aria-expanded: false` stays "false")
 *  - `value`: set as the property
 *  - other booleans: assigned as a property when the element has one
 *    (disabled, hidden, checked, ...), else attribute presence; false/null skip
 *  - everything else: setAttribute(String(value))
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...Child} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (/^on[A-Z]/.test(key)) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key.startsWith('aria-')) el.setAttribute(key, String(value));
    else if (key === 'value') /** @type {any} */ (el).value = value;
    else if (typeof value === 'boolean') {
      if (key in el) /** @type {any} */ (el)[key] = value;
      else if (value) el.setAttribute(key, '');
    } else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

/** @param {HTMLElement} el @param {readonly (Child | readonly Child[])[]} children */
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(typeof c === 'object' ? /** @type {Node} */ (c) : String(c));
  }
}

/**
 * A one-line label as a span: control characters shown as pictures (see
 * visible.js), and whitespace that would otherwise be invisible (edges, runs
 * of 2+) wrapped in a styled span.
 * @param {string} label
 * @param {string} [cls]
 */
export function nameNode(label, cls = 'name') {
  const text = visibleControls(label);
  return h('span', { class: cls, title: text },
    splitWhitespace(text).map((p) => (p.ws ? h('span', { class: 'ws' }, p.text) : p.text)));
}

/** @param {number} n */
export const problemWord = (n) => `${n} problem${n === 1 ? '' : 's'}`;

/** The ⚠ marker of something with `n` problems (the count is in its title). @param {number} n */
export const warnMarker = (n) => h('span', { class: 'warn-mark', title: problemWord(n), 'aria-hidden': true }, '⚠');

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'number', 'password', 'tel']);

/**
 * True when native text editing should keep a key (global shortcuts must not
 * act on it).
 * @param {EventTarget | null} t
 */
export const isTextField = (t) => t instanceof HTMLTextAreaElement
  || (t instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(t.type))
  || (t instanceof HTMLElement && t.isContentEditable);

/**
 * Make `el` match `fresh` (attributes and children) in place, so the element
 * itself (focus, pending click target, scroll anchor) survives.
 * @param {HTMLElement} el
 * @param {HTMLElement} fresh
 */
function morph(el, fresh) {
  for (const a of [...el.attributes]) if (!fresh.hasAttribute(a.name)) el.removeAttribute(a.name);
  for (const a of fresh.attributes) if (el.getAttribute(a.name) !== a.value) el.setAttribute(a.name, a.value);
  el.replaceChildren(...fresh.childNodes);
}

/** @typedef {{el:HTMLElement, sig:string}} Keyed */
/** @typedef {{key:string, sig:string, build:() => HTMLElement}} KeyedSpec */

/**
 * Keyed reconciliation of `parent`'s children: an element whose key was
 * shown before is reused (rebuilt in place only when its signature changed),
 * the rest are created, and anything else is removed. Reused elements on the
 * longest run already in order stay put; only the others are moved, so moving
 * one row past hundreds touches one element. Elements must not carry their
 * own listeners that depend on content (use delegation).
 * @param {HTMLElement} parent
 * @param {readonly KeyedSpec[]} specs in display order, unique keys
 * @param {ReadonlyMap<string, Keyed>} prev result of the previous call
 * @returns {Map<string, Keyed>}
 */
export function reconcileChildren(parent, specs, prev) {
  /** @type {Map<string, Keyed>} */
  const next = new Map();
  /** @type {HTMLElement[]} */
  const els = [];
  for (const s of specs) {
    let entry = prev.get(s.key);
    if (!entry) entry = { el: s.build(), sig: s.sig };
    else if (entry.sig !== s.sig) {
      morph(entry.el, s.build());
      entry = { el: entry.el, sig: s.sig };
    }
    next.set(s.key, entry);
    els.push(entry.el);
  }
  const keep = new Set(els);
  /** @type {Map<Node, number>} current position of each reused element */
  const oldPos = new Map();
  for (const child of [...parent.childNodes]) {
    if (keep.has(/** @type {HTMLElement} */ (child))) oldPos.set(child, oldPos.size);
    else child.remove();
  }
  const stay = stableSet(els.map((el) => oldPos.get(el) ?? -1));
  /** @type {Node | null} */
  let anchor = null;
  for (let i = els.length - 1; i >= 0; i--) {
    if (!stay.has(i)) parent.insertBefore(els[i], anchor);
    anchor = els[i];
  }
  return next;
}

/**
 * Indexes of a longest strictly increasing subsequence of `pos`, ignoring
 * -1 (new elements): the reused elements that can stay where they are.
 * @param {number[]} pos
 * @returns {Set<number>}
 */
function stableSet(pos) {
  /** @type {number[]} index into pos of the smallest tail of each run length */
  const tails = [];
  /** @type {number[]} */
  const prevIdx = new Array(pos.length).fill(-1);
  for (let i = 0; i < pos.length; i++) {
    const v = pos[i];
    if (v < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pos[tails[mid]] < v) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prevIdx[i] = tails[lo - 1];
    tails[lo] = i;
  }
  /** @type {Set<number>} */
  const out = new Set();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prevIdx[i]) out.add(i);
  return out;
}

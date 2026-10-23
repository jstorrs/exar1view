// @ts-check
/**
 * The selected program's steps as a flat multi-select list (display order:
 * a fork's Split, its branches' steps, its Join). Selection state is pure
 * (core/listsel.js); this file draws and forwards events. The pane talks to
 * it only through StepList, so a richer program view can take its place.
 */
import { h, isTextField, nameNode, problemWord, warnMarker } from './dom.js';
import { visibleControls } from '../core/visible.js';
import { displaySteps } from '../core/model.js';
import {
  EMPTY_SELECTION, clickSelect, moveSelect, toggleFocus, selectAll, reconcileSelection, selectedInOrder,
} from '../core/listsel.js';

/** @typedef {import('../core/model.js').Program} Program */
/** @typedef {import('../core/model.js').StepKind} StepKind */
/** @typedef {import('../core/listsel.js').ListSelection} ListSelection */

/**
 * @typedef {object} StepList
 * @property {HTMLElement} el the list element (role=listbox)
 * @property {(view: StepListView) => void} show list a program's steps, or `emptyText` without
 *   one; the selection survives while the program stays the same
 * @property {() => string[]} selected selected step keys in list order
 * @property {() => void} focus
 */

/**
 * `matches`: step keys to highlight; `name`: the list's accessible name.
 * @typedef {{program: Program | null, matches: ReadonlySet<string>, emptyText: string, name: string}} StepListView
 */

/** @type {Record<StepKind, string>} */
const KIND_ABBR = {
  Measurement: 'M', Pause: 'P', Interaction: 'I', Decision: 'D', Workflow: 'W', Split: 'S', Join: 'J',
};

let listCounter = 0;

/**
 * @param {{
 *   onChange: () => void,
 *   onContextMenu: (at: {x:number, y:number}, returnFocus: HTMLElement) => void,
 * }} opts
 * @returns {StepList}
 */
export function createStepList({ onChange, onContextMenu }) {
  const id = `steps${++listCounter}`;
  /** @type {Program | null} */
  let program = null;
  /** @type {ReadonlySet<string>} */
  let matches = new Set();
  let emptyText = '';
  /** @type {string[]} */
  let items = [];
  /** @type {Map<string, HTMLElement>} */
  let itemEls = new Map();
  /** @type {ListSelection} */
  let sel = EMPTY_SELECTION;

  const el = h('div', {
    class: 'list', role: 'listbox', tabindex: 0, 'aria-multiselectable': true,
    onKeydown: onKey, onClick, onContextmenu: onMenu,
  });

  /** @type {StepList['show']} */
  function show(view) {
    el.setAttribute('aria-label', view.name);
    if (view.program === program && view.matches === matches && view.emptyText === emptyText) return;
    const next = view.program;
    const prevItems = items;
    const sameProgram = next !== null && next === program;
    program = next;
    matches = view.matches;
    emptyText = view.emptyText;
    const steps = next ? displaySteps(next.body) : [];
    items = steps.map((s) => s.key);
    sel = sameProgram ? reconcileSelection(prevItems, items, sel) : EMPTY_SELECTION;
    const top = el.scrollTop;
    if (steps.length === 0) {
      el.replaceChildren(h('div', { class: 'empty' }, next ? 'No steps' : emptyText));
    } else {
      el.replaceChildren(...steps.map((s, i) => h('div', {
        id: `${id}-${i}`,
        class: ['item', 'step', matches.has(s.key) && 'match'].filter(Boolean).join(' '),
        role: 'option', 'aria-selected': false,
        'aria-label': `${i + 1}, ${s.kind}, ${visibleControls(s.label)}${s.problems.length ? `, ${problemWord(s.problems.length)}` : ''}`,
        dataset: { key: s.key },
      },
        h('span', { class: 'step-index', 'aria-hidden': true }, i + 1),
        h('span', { class: `kind kind-${s.kind.toLowerCase()}`, title: s.kind, 'aria-hidden': true }, KIND_ABBR[s.kind]),
        nameNode(s.label),
        s.problems.length ? warnMarker(s.problems.length) : null)));
    }
    itemEls = new Map(steps.map((s, i) => [s.key, /** @type {HTMLElement} */ (el.children[i])]));
    el.scrollTop = sameProgram ? top : 0;
    sync(false);
  }

  /** Move classes/ARIA to the current selection. @param {boolean} scroll */
  function sync(scroll) {
    for (const [key, itemEl] of itemEls) {
      const on = sel.selected.has(key);
      if (itemEl.classList.contains('selected') !== on) {
        itemEl.classList.toggle('selected', on);
        itemEl.setAttribute('aria-selected', String(on));
      }
      itemEl.classList.toggle('focus', key === sel.focus);
    }
    const focusEl = sel.focus === null ? null : itemEls.get(sel.focus);
    if (focusEl) {
      el.setAttribute('aria-activedescendant', focusEl.id);
      if (scroll) focusEl.scrollIntoView({ block: 'nearest' });
    } else el.removeAttribute('aria-activedescendant');
  }

  /** @param {ListSelection} next */
  function setSel(next) {
    if (next === sel) return;
    sel = next;
    sync(true);
    onChange();
  }

  /** @param {MouseEvent} e */
  function keyAt(e) {
    const itemEl = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[role=option]'));
    return itemEl?.dataset.key ?? null;
  }

  /** @param {MouseEvent} e */
  function onClick(e) {
    const key = keyAt(e);
    el.focus();
    if (key === null) {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) setSel(EMPTY_SELECTION);
      return;
    }
    setSel(clickSelect(items, sel, key, { toggle: e.ctrlKey || e.metaKey, extend: e.shiftKey }));
  }

  /** @param {MouseEvent} e */
  function onMenu(e) {
    e.preventDefault();
    const key = keyAt(e);
    if (key === null && e.target === el) {
      // Keyboard-originated (focus is on the list itself).
      menuAt();
      return;
    }
    // The menu is about the file, so the selection stays as it is.
    el.focus();
    onContextMenu({ x: e.clientX, y: e.clientY }, el);
  }

  /** Open the context menu next to the focus item (keyboard). */
  function menuAt() {
    const r = ((sel.focus === null ? null : itemEls.get(sel.focus)) ?? el).getBoundingClientRect();
    onContextMenu({ x: r.left + 24, y: r.top + Math.min(r.height, 28) }, el);
  }

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (isTextField(e.target)) return;
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      menuAt();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (e.altKey) return;
    /** @type {import('../core/listsel.js').Move | null} */
    const move = e.key === 'ArrowDown' ? 'next' : e.key === 'ArrowUp' ? 'prev'
      : e.key === 'Home' ? 'first' : e.key === 'End' ? 'last' : null;
    if (move && !mod) {
      e.preventDefault();
      setSel(moveSelect(items, sel, move, { extend: e.shiftKey }));
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSel(selectAll(items, sel));
    } else if (mod && e.key === ' ') {
      e.preventDefault();
      setSel(toggleFocus(items, sel));
    }
  }

  return {
    el,
    show,
    selected: () => selectedInOrder(items, sel),
    focus: () => el.focus(),
  };
}


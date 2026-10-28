// @ts-check
/**
 * The selected program (adapted from protocols-web ui/programpane.js): a header
 * (label, comment, counts, problems, a banner when the step order fell back to
 * rank), its body as a multi-select listbox with condition and choice rows
 * showing forks, and a collapsible facts panel for the focused step. A DOM
 * shell over core/body.js, core/stepinfo.js and core/listsel.js: only step
 * rows are options; condition and choice rows are presentation. The pane
 * talks to it only through ProgramPane.
 */
import { USES_CUSTOM, flaskMarker, h, isTextField, nameNode, problemWord, warnMarker } from './dom.js';
import { visibleControls, visibleText } from '../core/visible.js';
import { flattenBody, stepRows, stepRowLabel, rankReason } from '../core/body.js';
import { stepFacts, stepTags, copyRefIndex, stepCopyRefs, copyRefFact, copyTags, contrastNote, addInView, NO_ADDINS } from '../core/stepinfo.js';
import { programProblems } from '../core/workspace.js';
import { formatTa } from '../core/preview.js';
import {
  EMPTY_SELECTION, clickSelect, moveSelect, toggleFocus, selectAll, reconcileSelection, selectedInOrder, selectKeys,
} from '../core/listsel.js';

/** @typedef {import('../core/model.js').Program} Program */
/** @typedef {import('../core/model.js').Step} Step */
/** @typedef {import('../core/model.js').StepKind} StepKind */
/** @typedef {import('../core/body.js').BodyRow} BodyRow */
/** @typedef {import('../core/body.js').StepRow} StepRow */
/** @typedef {import('../core/stepinfo.js').CopyRefInfo} CopyRefInfo */
/** @typedef {import('../core/listsel.js').ListSelection} ListSelection */
/** @typedef {import('../core/stepinfo.js').AddIns} AddIns */
/** @typedef {import('../core/preview.js').ProgramTa} ProgramTa */

/**
 * @typedef {object} ProgramPane
 * @property {HTMLElement} el header, step list and facts panel
 * @property {(view: ProgramView) => void} show a program, or `emptyText` without one; the
 *   selection survives while the program stays the same
 * @property {() => string[]} selected selected step keys in list order
 * @property {(key: string) => void} select select just this step (no-op if it is not listed)
 * @property {() => void} focus focus the step list
 */

/**
 * `matches`: step keys to highlight; `marks`: step keys to mark as using customer sequences;
 * `addIns`: the add-ins read so far, to name them; `ta`: the program's total acquisition time once
 * read, else null (nothing is shown); `name`: the list's accessible name.
 * @typedef {{program: Program | null, matches: ReadonlySet<string>, marks: ReadonlySet<string>, addIns: AddIns,
 *   ta: ProgramTa | null, emptyText: string, name: string}} ProgramView
 */

/** @type {Record<StepKind, string>} */
const KIND_ABBR = {
  Measurement: 'M', Pause: 'P', Interaction: 'I', Decision: 'D', Workflow: 'W', Split: 'S', Join: 'J',
};

/** @param {number} depth */
const depthClass = (depth) => `d${Math.min(depth, 4)}`;

/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

let paneCounter = 0;

/**
 * @param {{
 *   onChange: () => void,
 *   onContextMenu: (at: {x:number, y:number}, returnFocus: HTMLElement) => void,
 *   onProblems: (program: Program) => void,
 *   onFocus?: (step: Step | null) => void,
 * }} opts `onFocus`: the step the facts panel shows changed (the focused step, or none)
 * @returns {ProgramPane}
 */
export function createProgramPane({ onChange, onContextMenu, onProblems, onFocus = () => {} }) {
  const id = `steps${++paneCounter}`;
  /** @type {Program | null} */
  let program = null;
  /** @type {ReadonlySet<string>} */
  let matches = new Set();
  /** @type {ReadonlySet<string>} */
  let marks = new Set();
  /** @type {AddIns} */
  let addIns = NO_ADDINS;
  /** @type {ProgramTa | null} */
  let ta = null;
  let emptyText = '';
  /** @type {string[]} */
  let items = [];
  /** @type {Map<string, HTMLElement>} */
  let itemEls = new Map();
  /** @type {Map<string, StepRow>} */
  let rowsByKey = new Map();
  /** @type {Map<string, CopyRefInfo[]>} */
  let refIndex = new Map();
  /** @type {ListSelection} */
  let sel = EMPTY_SELECTION;
  /** The step (and program) the facts panel shows. */
  let factsFor = /** @type {{program: Program | null, key: string | null, addIns: AddIns}} */ ({ program: null, key: null, addIns: NO_ADDINS });

  const headEl = h('div', { class: 'program-head', hidden: true });
  const listEl = h('div', {
    class: 'list', role: 'listbox', tabindex: 0, 'aria-multiselectable': true,
    onKeydown: onKey, onClick, onContextmenu: onMenu,
    onMouseover: (/** @type {MouseEvent} */ e) => linkCopies(/** @type {Element} */ (e.target).closest('.copyref')),
    onMouseleave: () => linkCopies(null),
  });
  const taEl = h('div', { class: 'program-ta', hidden: true });
  const factsTitle = h('span', null, 'Step facts');
  const factsBody = h('div', { class: 'facts-body' });
  // <details> keeps its open state for as long as the page is open.
  const factsEl = h('details', { class: 'facts-panel', open: true, hidden: true },
    h('summary', { class: 'facts-summary' }, factsTitle), factsBody);
  const el = h('div', { class: 'program' }, headEl, listEl, taEl, factsEl);

  /** @type {ProgramPane['show']} */
  function show(view) {
    listEl.setAttribute('aria-label', view.name);
    const same = view.program === program && view.matches === matches && view.marks === marks && view.addIns === addIns
      && view.emptyText === emptyText;
    if (same) {
      // Only the total can differ: leave the list alone (a click or hover in progress survives).
      if (view.ta !== ta) {
        ta = view.ta;
        renderTa();
      }
      return;
    }
    const next = view.program;
    const prevItems = items;
    const sameProgram = next !== null && next === program;
    program = next;
    matches = view.matches;
    marks = view.marks;
    addIns = view.addIns;
    ta = view.ta;
    emptyText = view.emptyText;
    const rows = next ? flattenBody(next) : [];
    const steps = stepRows(rows);
    items = steps.map((r) => r.key);
    rowsByKey = new Map(steps.map((r) => [r.key, r]));
    refIndex = next ? copyRefIndex(next) : new Map();
    sel = sameProgram ? reconcileSelection(prevItems, items, sel) : EMPTY_SELECTION;
    if (!sameProgram) renderHead(next, steps);
    const top = listEl.scrollTop;
    itemEls = new Map();
    if (rows.length === 0) {
      listEl.replaceChildren(h('div', { class: 'empty' }, next ? 'No steps' : emptyText));
    } else {
      listEl.replaceChildren(...rows.map((r, i) => {
        const rowEl = rowNode(r, `${id}-${i}`);
        if (r.type === 'step') itemEls.set(r.key, rowEl);
        return rowEl;
      }));
    }
    listEl.scrollTop = sameProgram ? top : 0;
    renderTa();
    sync(false);
  }

  /** The total TA under the list. */
  function renderTa() {
    taEl.hidden = ta === null;
    if (ta === null) return;
    const without = ta.without === 0 ? '' : ` (${plural(ta.without, 'step', 'steps')} without TA)`;
    const path = program?.body.some((n) => n.type === 'fork') ? ' (default path)' : '';
    taEl.textContent = `Total TA ${formatTa(ta.sec)}${path}${without}`;
  }

  /** @param {Program | null} p @param {readonly StepRow[]} steps */
  function renderHead(p, steps) {
    headEl.hidden = p === null;
    if (p === null) {
      headEl.replaceChildren();
      return;
    }
    const measurements = steps.filter((r) => r.step.kind === 'Measurement').length;
    const problems = programProblems(p).length;
    const reason = rankReason(p);
    headEl.replaceChildren(h('div', null,
      h('div', { class: 'program-title' },
        nameNode(p.label, 'program-label'),
        problems ? h('button', {
          type: 'button', class: 'btn btn-small warn-btn', title: `Show this program's ${problemWord(problems)}`,
          'aria-label': `Show this program's ${problemWord(problems)}`,
          onClick: () => onProblems(p),
        }, `⚠ ${problems}`) : null),
      p.comment ? h('div', { class: 'program-comment' }, visibleText(p.comment)) : null,
      h('div', { class: 'program-counts' },
        `${plural(steps.length, 'step', 'steps')} · ${plural(measurements, 'measurement', 'measurements')}`),
      reason === null ? null : h('div', { class: 'banner-warn', role: 'note' },
        'Step order could not be read; steps are shown by rank.',
        reason ? h('span', { class: 'banner-reason' }, ` ${visibleText(reason)}`) : null)));
  }

  /** @param {BodyRow} row @param {string} rowId */
  function rowNode(row, rowId) {
    const depth = depthClass(row.depth);
    if (row.type === 'condition') {
      const c = row.condition;
      return h('div', {
        class: `brow cond ${depth}`, role: 'presentation', 'aria-hidden': true,
        title: c.description === null ? null : visibleControls(c.description),
      },
        h('span', { class: 'cond-kind' }, `${c.kind}:`),
        nameNode(c.label));
    }
    if (row.type === 'choice') {
      return h('div', { class: `brow choice ${depth}`, role: 'presentation', 'aria-hidden': true },
        nameNode(row.choice.label),
        row.isDefault ? h('span', { class: 'default' }, '(default)') : null,
        row.empty ? h('span', { class: 'empty-note' }, '(no steps)') : null);
    }
    const s = row.step;
    const refs = stepCopyRefs(s, refIndex);
    const tags = copyTags(refs);
    const contrast = contrastNote(s);
    const custom = marks.has(s.key);
    const addIn = addInView(s, addIns);
    const label = [
      stepRowLabel(row),
      custom ? USES_CUSTOM.toLowerCase() : '',
      contrast === null ? '' : `contrast: ${visibleControls(contrast)}`,
      ...tags.map((g) => g.aria),
      s.problems.length ? problemWord(s.problems.length) : '',
      addIn?.aria ?? '',
    ].filter(Boolean).join(', ');
    return h('div', {
      id: rowId,
      class: ['item', 'brow', 'step', depth, matches.has(s.key) && 'match', custom && 'custom'].filter(Boolean).join(' '),
      role: 'option', 'aria-selected': false, 'aria-label': label,
      dataset: { key: s.key },
    },
      h('span', { class: `kind kind-${s.kind.toLowerCase()}`, title: s.kind, 'aria-hidden': true }, KIND_ABBR[s.kind]),
      nameNode(s.label),
      custom ? flaskMarker(USES_CUSTOM) : null,
      contrast === null ? null : h('span', { class: 'contrast', title: 'Applies contrast agent', 'aria-hidden': true },
        visibleControls(contrast)),
      ...tags.map((g) => h('span', {
        class: `copyref ${g.role === 'source' ? 'src' : 'dst'}${g.broken ? ' broken' : ''}`, title: g.title, 'aria-hidden': true,
        dataset: { copy: String(g.number) },
      }, String(g.number))),
      s.problems.length ? warnMarker(s.problems.length) : null,
      // Right-aligned, as the scanner shows the add-in type on the step.
      addIn ? h('span', { class: 'addin', title: addIn.title, 'aria-hidden': true }, addIn.text) : null);
  }

  /**
   * Highlight every step of the hovered tag's copy reference: its source and destinations.
   * @param {Element | null} tag
   */
  function linkCopies(tag) {
    const copy = tag instanceof HTMLElement ? tag.dataset.copy ?? null : null;
    for (const e of listEl.querySelectorAll('.copy-linked, .copyref.linked')) e.classList.remove('copy-linked', 'linked');
    if (copy === null) return;
    for (const t of listEl.querySelectorAll(`.copyref[data-copy="${copy}"]`)) {
      t.classList.add('linked');
      t.closest('.item')?.classList.add('copy-linked');
    }
  }

  /** Show the focused step's facts, unless they are shown already. */
  function renderFacts() {
    const key = sel.focus;
    if (factsFor.program === program && factsFor.key === key && factsFor.addIns === addIns) return;
    const focusChanged = factsFor.program !== program || factsFor.key !== key;
    factsFor = { program, key, addIns };
    factsEl.hidden = program === null;
    const row = key === null ? undefined : rowsByKey.get(key);
    if (focusChanged) onFocus(program && row ? row.step : null);
    if (!program || !row) {
      factsTitle.textContent = 'Step facts';
      factsBody.replaceChildren(h('div', { class: 'empty' }, 'Select a step to see its facts'));
      return;
    }
    const s = row.step;
    factsTitle.textContent = `Step facts: ${visibleControls(s.label)}`;
    const tags = stepTags(s);
    const refs = stepCopyRefs(s, refIndex);
    factsBody.replaceChildren(h('div', null,
      factList(stepFacts(s, program, addIns).map((f) => [f.label, f.value])),
      tags.length ? section('Tags', factList(tags)) : null,
      refs.length ? section('Copy references',
        h('ul', { class: 'copyrefs' }, refs.map((r) => h('li', { class: r.broken ? 'broken' : null },
          copyRefFact(r))))) : null,
      s.problems.length ? section('Problems',
        h('ul', { class: 'step-problems' }, s.problems.map((p) => h('li', { class: `problem-${p.level}` },
          h('span', { class: 'problem-level' }, p.level === 'error' ? 'Error' : 'Warning'), ` ${visibleText(p.message)}`)))) : null));
  }

  /** @param {string} title @param {HTMLElement} body */
  const section = (title, body) => h('section', null, h('h3', { class: 'facts-title' }, title), body);

  /** @param {readonly (readonly [string, string | null])[]} pairs */
  function factList(pairs) {
    return h('dl', { class: 'facts' }, pairs.flatMap(([k, v]) => [
      h('dt', null, visibleControls(k)),
      v === null ? h('dd', { class: 'none' }, '—')
        : v === '' ? h('dd', { class: 'none' }, '(empty)') : h('dd', null, visibleText(v)),
    ]));
  }

  /** Move classes/ARIA to the current selection and update the facts. @param {boolean} scroll */
  function sync(scroll) {
    for (const [key, itemEl] of itemEls) {
      const on = sel.selected.has(key);
      if (itemEl.classList.contains('selected') !== on) {
        itemEl.classList.toggle('selected', on);
        itemEl.setAttribute('aria-selected', String(on));
      }
      itemEl.classList.toggle('focus', key === sel.focus);
    }
    // Facts first: the list's height may change with them, and then the scroll is right.
    renderFacts();
    const focusEl = sel.focus === null ? null : itemEls.get(sel.focus);
    if (focusEl) {
      listEl.setAttribute('aria-activedescendant', focusEl.id);
      if (scroll) focusEl.scrollIntoView({ block: 'nearest' });
    } else listEl.removeAttribute('aria-activedescendant');
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
    listEl.focus();
    if (key === null) {
      // Condition and choice rows are not steps: a click there leaves the selection alone.
      const onStructure = /** @type {Element} */ (e.target).closest('.brow') !== null;
      if (!onStructure && !e.ctrlKey && !e.metaKey && !e.shiftKey) setSel(EMPTY_SELECTION);
      return;
    }
    setSel(clickSelect(items, sel, key, { toggle: e.ctrlKey || e.metaKey, extend: e.shiftKey }));
  }

  /** @param {MouseEvent} e */
  function onMenu(e) {
    e.preventDefault();
    const key = keyAt(e);
    if (key === null && e.target === listEl) {
      // Keyboard-originated (focus is on the list itself).
      menuAt();
      return;
    }
    // The menu is about the file, so the selection stays as it is.
    listEl.focus();
    onContextMenu({ x: e.clientX, y: e.clientY }, listEl);
  }

  /** Open the context menu next to the focus item (keyboard). */
  function menuAt() {
    const r = ((sel.focus === null ? null : itemEls.get(sel.focus)) ?? listEl).getBoundingClientRect();
    onContextMenu({ x: r.left + 24, y: r.top + Math.min(r.height, 28) }, listEl);
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
    select: (key) => { if (items.includes(key)) setSel(selectKeys(items, [key])); },
    focus: () => listEl.focus(),
  };
}

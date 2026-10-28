// @ts-check
/**
 * The program-compare view: a full-height section that takes the place of the panes and
 * shows two programs side by side, one row per step, fork, condition or branch, with a mark
 * between the sides. A DOM shell over core/progdiffview.js. Header: title, status line,
 * Close; then each program (file, Region › Exam › Program), the step-order warning, and the
 * "Show unchanged" toggle (unchanged runs of steps are collapsed otherwise); then the table.
 * The pair is a snapshot while open: comparing other programs means pressing Compare programs
 * again. Escape closes it. A measurement pair whose protocols differ has a button opening the
 * Compare steps drawer for it under this view; closing this view closes that drawer too.
 */
import { h, nameNode } from './dom.js';
import { visibleControls } from '../core/visible.js';
import { comparePrograms } from '../core/progdiff.js';
import {
  compareRows, collapseSame, compareCounts, programCompareStatus, rankWarning, diffValue, measurementSides,
} from '../core/progdiffview.js';

/** @typedef {import('../core/progdiffview.js').ProgramSide} ProgramSide */
/** @typedef {import('../core/progdiffview.js').CmpRow} CmpRow */
/** @typedef {import('../core/model.js').Step} Step */
/** @typedef {import('../core/progdiffview.js').Mark} Mark */
/** @typedef {import('../core/diffview.js').Side} Side */
/** @typedef {import('../core/progdiff.js').FieldDiff} FieldDiff */
/** @template T @typedef {import('../core/progdiff.js').Paired<T>} Paired */

/**
 * @typedef {object} ProgramCompare
 * @property {(pair: { a: ProgramSide, b: ProgramSide }) => void} open compare a pair (replacing the one shown)
 * @property {() => void} close
 * @property {(fileId: string) => void} fileClosed close the view if it shows a program of that file
 * @property {() => boolean} isOpen
 * @property {() => void} focus focus the view's title
 */

/** Glyph and spoken name per mark; the glyph carries the meaning, colour is secondary. @type {Record<Mark, { glyph: string, name: string, cls: string }>} */
const MARKS = {
  same: { glyph: '=', name: 'same', cls: 'pc-same' },
  changed: { glyph: '≠', name: 'changed', cls: 'pc-changed' },
  moved: { glyph: '↕', name: 'moved', cls: 'pc-moved' },
  a: { glyph: '−', name: 'only in A', cls: 'pc-onlya' },
  b: { glyph: '+', name: 'only in B', cls: 'pc-onlyb' },
};

/**
 * One side of a paired thing, null where it is missing on that side.
 * @template T
 * @param {Paired<T>} p
 * @param {'a' | 'b'} side
 * @returns {T | null}
 */
function pick(p, side) {
  if (p.in === 'both') return p[side];
  if (p.in === 'a') return side === 'a' ? p.a : null;
  return side === 'b' ? p.b : null;
}

/** @param {number} depth */
const depthClass = (depth) => `d${Math.min(depth, 4)}`;

/**
 * @param {HTMLElement} container
 * @param {{
 *   cover: HTMLElement,
 *   announce: (text: string) => void,
 *   onClose: () => void,
 *   compareSteps: (pair: { a: Side, b: Side }) => void,
 *   closeSteps: () => void,
 * }} deps `cover` is hidden while the view is open; `announce` says the status to screen
 *   readers once per open; `onClose` runs when the view closes and focus has nowhere to return;
 *   `compareSteps` opens the step drawer for a pair of this view's steps, `closeSteps` closes it
 * @returns {ProgramCompare}
 */
export function createProgramCompare(container, { cover, announce, onClose, compareSteps, closeSteps }) {
  /** @type {{ a: ProgramSide, b: ProgramSide } | null} */
  let pair = null;
  /** @type {import('../core/progdiffview.js').CmpRow[]} */
  let rows = [];
  /** @type {HTMLElement | null} */
  let returnFocus = null;
  /** The A step of each moved pair by move id, for the B row's Compare steps button. @type {Map<number, Step>} */
  let movedA = new Map();

  const title = h('h2', { id: 'pc-title', class: 'cp-title', tabindex: -1 }, 'Compare programs');
  const statusEl = h('div', { class: 'cp-status' });
  const sidesEl = h('div', { class: 'cp-sides' });
  const warnEl = h('div', { class: 'banner-warn', role: 'note', hidden: true });
  const unchanged = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', onChange: () => renderTable() }));
  const tableEl = h('div', { class: 'cp-table', tabindex: 0, role: 'region', 'aria-label': 'Program differences' });
  container.classList.add('program-compare');
  container.setAttribute('aria-labelledby', 'pc-title');
  container.hidden = true;
  container.replaceChildren(
    h('div', { class: 'cp-head' }, title, statusEl,
      h('button', { type: 'button', class: 'btn btn-small', title: 'Close the comparison (Escape)', onClick: () => close() }, 'Close')),
    sidesEl,
    warnEl,
    h('div', { class: 'cp-controls' },
      h('label', { class: 'cp-toggle', title: 'Runs of unchanged steps are collapsed otherwise' }, unchanged, ' Show unchanged')),
    tableEl);
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });

  /** @param {{ a: ProgramSide, b: ProgramSide }} next */
  function open(next) {
    if (container.hidden) {
      const active = document.activeElement;
      returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    pair = next;
    rows = compareRows(comparePrograms(next.a.program, next.b.program));
    movedA = new Map(rows.flatMap((r) => (r.type === 'step' && r.in === 'a' && r.moved ? [[r.moved.id, r.a]] : [])));
    unchanged.checked = false;
    const warning = rankWarning(next);
    warnEl.hidden = warning === null;
    warnEl.textContent = warning ?? '';
    const status = programCompareStatus(compareCounts(rows));
    statusEl.textContent = status;
    sidesEl.replaceChildren(sideNode('A', next.a), sideNode('B', next.b));
    renderTable();
    cover.hidden = true;
    container.hidden = false;
    title.focus();
    announce(`Compare programs: ${status}`);
  }

  function close() {
    if (container.hidden) return;
    closeSteps();
    pair = null;
    rows = [];
    movedA = new Map();
    container.hidden = true;
    cover.hidden = false;
    sidesEl.replaceChildren();
    tableEl.replaceChildren();
    const back = returnFocus;
    returnFocus = null;
    if (back?.isConnected && !back.closest('[hidden]')) back.focus();
    if (back === null || document.activeElement !== back) onClose();
  }

  /** @param {string} tag @param {ProgramSide} side */
  function sideNode(tag, side) {
    return h('div', { class: 'cp-side' },
      h('div', { class: 'cp-side-title' },
        h('span', { class: 'cp-tag', 'aria-hidden': true }, tag),
        h('span', { class: 'sr-only' }, `${tag}: `),
        nameNode(side.program.label, 'name cp-step')),
      h('div', { class: 'cp-where' }, nameNode(side.file.name, 'name cp-file'),
        h('span', { class: 'sep', 'aria-hidden': true }, '·'),
        nameNode([...side.path, side.program.label].join(' › '), 'name cp-path')));
  }

  function renderTable() {
    tableEl.replaceChildren(h('table', { class: 'diff-table pc-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'A'), h('th', { scope: 'col', class: 'pc-mark' }, 'Difference'), h('th', { scope: 'col' }, 'B'))),
      h('tbody', null, collapseSame(rows, unchanged.checked).map(rowNode))));
  }

  /** @param {CmpRow} r */
  function rowNode(r) {
    if (r.type === 'collapsed') {
      return h('tr', { class: 'pc-collapsed' }, h('td', { colspan: 3 }, `… ${r.count} unchanged ${r.count === 1 ? 'step' : 'steps'}`));
    }
    const m = MARKS[r.mark];
    return h('tr', { class: m.cls },
      sideCell(r, 'a'),
      h('td', { class: 'pc-mark' }, h('span', { 'aria-hidden': true }, m.glyph), h('span', { class: 'sr-only' }, m.name)),
      sideCell(r, 'b'));
  }

  /** @param {Exclude<CmpRow, { type: 'collapsed' }>} r @param {'a' | 'b'} side */
  function sideCell(r, side) {
    if (r.type === 'header') return h('td', { class: 'pc-cell d0' }, h('strong', null, 'Program'), diffLines(r.diffs, side));
    /** @type {HTMLElement | null} */
    let main;
    /** @type {readonly FieldDiff[]} */
    let diffs = r.in === 'both' ? r.diffs : r.type === 'step' ? r.moved?.diffs ?? [] : [];
    switch (r.type) {
      case 'condition': {
        const c = pick(r, side);
        main = c && h('div', null, h('span', { class: 'cond-kind' }, `${c.kind}: `), nameNode(c.label));
        break;
      }
      case 'choice': {
        const c = pick(r, side);
        main = c && h('div', { class: 'pc-choice' }, nameNode(c.choice.label),
          c.isDefault ? h('span', { class: 'default' }, ' (default)') : null,
          c.empty ? h('span', { class: 'empty-note' }, ' (no steps)') : null);
        // The default flag shows as "(default)" already.
        diffs = diffs.filter((d) => d.field !== 'Default');
        break;
      }
      default: {
        const st = pick(r, side);
        main = st && h('div', null, h('span', { class: 'pc-kind' }, `${st.kind} `), nameNode(st.label));
      }
    }
    if (main === null) return h('td', { class: 'pc-cell' });
    return h('td', { class: `pc-cell ${depthClass(r.depth)}` }, main, diffLines(diffs, side),
      r.type === 'step' && (r.protocol ?? r.moved?.protocol) === 'differs' ? h('div', { class: 'pc-diff' }, 'Protocol differs') : null,
      r.type === 'step' && side === 'b' ? stepsButton(r) : null);
  }

  /** The button under the B side's "Protocol differs" line, opening Compare steps for the pair (a moved pair's A step is found by its move id). @param {Extract<CmpRow, { type: 'step' }>} r */
  function stepsButton(r) {
    const sa = r.in === 'both' ? r.a : r.in === 'b' && r.moved ? movedA.get(r.moved.id) : undefined;
    if (!sa || r.in === 'a' || (r.protocol ?? r.moved?.protocol) !== 'differs') return null;
    const sb = r.b;
    return h('button', {
      type: 'button', class: 'btn btn-small pc-steps', 'aria-label': 'Compare steps of this pair',
      onClick: () => {
        const sides = pair && measurementSides(pair, sa, sb);
        if (sides) compareSteps(sides);
      },
    }, 'Compare steps');
  }

  /** @param {readonly FieldDiff[]} diffs @param {'a' | 'b'} side */
  function diffLines(diffs, side) {
    return diffs.map((d) => h('div', { class: 'pc-diff' }, `${visibleControls(d.field)}: ${diffValue(d.field, d[side])}`));
  }

  return {
    open,
    close,
    isOpen: () => !container.hidden,
    focus: () => title.focus(),
    fileClosed: (fileId) => {
      if (pair && (pair.a.file.id === fileId || pair.b.file.id === fileId)) close();
    },
  };
}

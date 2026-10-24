// @ts-check
/**
 * The compare panel (adapted from protocols-web ui/comparepanel.js and ui/difftable.js): a
 * bottom drawer comparing the protocol parameters of the two measurement steps it was opened
 * with. A DOM shell over core/diffview.js. Header: title, status line, Close; then each step
 * (file, Region › Exam › Program, label, sequence, or why its protocol could not be read); then
 * the key filter and the churn/ignored toggle; then the table of differing parameters. The pair
 * is fixed while open: comparing other steps means pressing Compare steps again, which also
 * resets the filter and the toggle. Escape closes it (or first clears the filter).
 */
import { h, nameNode } from './dom.js';
import { visibleControls } from '../core/visible.js';
import { compareStatus, diffRows, sequenceName } from '../core/diffview.js';
import { diffParams } from '../core/paramdiff.js';

/** @typedef {import('../core/diffview.js').Side} Side */
/** @typedef {import('../core/diffview.js').DiffRow} DiffRow */
/** @typedef {import('../core/paramdiff.js').ParamDiff} ParamDiff */
/** @typedef {import('../platform/source.js').Protocol} Protocol */

/**
 * @typedef {object} ComparePanel
 * @property {(pair: { a: Side, b: Side }) => void} open compare a pair (replacing the one shown)
 * @property {() => void} close
 * @property {(fileId: string) => void} fileClosed close the panel if it shows a step of that file
 */

const TIER_TITLE = /** @type {const} */ ({
  key: 'Key: defines the protocol',
  other: 'Other: unclassified',
  churn: 'Churn: changes when a protocol is scanned and re-saved',
  ignored: 'Ignored: never meaningful',
});

/**
 * @param {HTMLElement} container
 * @param {{
 *   load: (side: Side) => Promise<Protocol>,
 *   onClose: () => void,
 * }} deps `load` never rejects; `onClose` runs when the panel closes and focus has nowhere to return
 * @returns {ComparePanel}
 */
export function createComparePanel(container, { load, onClose }) {
  /** @type {{ a: Side, b: Side } | null} */
  let pair = null;
  /** The two protocols, null while loading. @type {[Protocol | null, Protocol | null]} */
  let protocols = [null, null];
  /** @type {ParamDiff[]} */
  let diffs = [];
  /** Bumped per open, so a late load of an earlier pair is dropped. */
  let generation = 0;
  /** @type {HTMLElement | null} */
  let returnFocus = null;

  const title = h('h2', { id: 'cp-title', class: 'cp-title', tabindex: -1 }, 'Compare steps');
  const statusEl = h('div', { class: 'cp-status', role: 'status' });
  const sidesEl = h('div', { class: 'cp-sides' });
  const filter = /** @type {HTMLInputElement} */ (h('input', {
    type: 'search', class: 'search cp-filter', placeholder: 'Filter parameters', autocomplete: 'off',
    spellcheck: false, 'aria-label': 'Filter parameters by name', onInput: () => renderTable(),
  }));
  const noise = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', onChange: () => renderTable() }));
  const hiddenEl = h('span', { class: 'cp-hidden' });
  const tableEl = h('div', { class: 'cp-table', tabindex: 0, role: 'region', 'aria-label': 'Differing parameters' });
  container.classList.add('compare-panel');
  container.setAttribute('aria-labelledby', 'cp-title');
  container.hidden = true;
  container.replaceChildren(
    h('div', { class: 'cp-head' }, title, statusEl,
      h('button', { type: 'button', class: 'btn btn-small', title: 'Close the comparison (Escape)', onClick: () => close() }, 'Close')),
    sidesEl,
    h('div', { class: 'cp-controls' }, filter,
      h('label', { class: 'cp-toggle', title: 'Churn changes when a protocol is scanned and re-saved; ignored is never meaningful' },
        noise, ' Show churn/ignored'),
      hiddenEl),
    tableEl);
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.target === filter && filter.value !== '') {
      filter.value = '';
      renderTable();
    } else close();
  });

  /** @param {{ a: Side, b: Side }} next */
  function open(next) {
    const gen = ++generation;
    if (container.hidden) {
      const active = document.activeElement;
      returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    pair = next;
    protocols = [null, null];
    diffs = [];
    // Each comparison starts unfiltered, with churn and ignored hidden.
    filter.value = '';
    noise.checked = false;
    container.hidden = false;
    render();
    title.focus();
    void Promise.all([load(next.a), load(next.b)]).then(([a, b]) => {
      if (gen !== generation) return;
      protocols = [a, b];
      diffs = a.ok && b.ok ? diffParams(a.blocks, b.blocks) : [];
      render();
    });
  }

  function close() {
    if (container.hidden) return;
    generation++;
    pair = null;
    protocols = [null, null];
    diffs = [];
    container.hidden = true;
    sidesEl.replaceChildren();
    tableEl.replaceChildren();
    const back = returnFocus;
    returnFocus = null;
    if (back?.isConnected && !back.closest('[hidden]')) back.focus(); else onClose();
  }

  const loading = () => protocols[0] === null || protocols[1] === null;

  function render() {
    if (!pair) return;
    const { a, b } = pair;
    const sameBlob = a.step.detail.protocolBlob !== null && a.step.detail.protocolBlob === b.step.detail.protocolBlob;
    const [pa, pb] = protocols;
    statusEl.textContent = sameBlob ? compareStatus(true, 0)
      : loading() ? 'Loading protocols…'
        : pa?.ok && pb?.ok ? compareStatus(false, diffs.length)
          : 'Could not compare: a protocol could not be read';
    sidesEl.replaceChildren(sideNode('A', a, pa), sideNode('B', b, pb));
    renderTable();
  }

  /** @param {string} tag @param {Side} side @param {Protocol | null} p */
  function sideNode(tag, side, p) {
    const sequence = p?.ok ? sequenceName(p.blocks) : null;
    return h('div', { class: 'cp-side' },
      h('div', { class: 'cp-side-title' },
        h('span', { class: 'cp-tag', 'aria-hidden': true }, tag),
        h('span', { class: 'sr-only' }, `${tag}: `),
        nameNode(side.step.label, 'name cp-step')),
      h('div', { class: 'cp-where' }, nameNode(side.file.name, 'name cp-file'),
        h('span', { class: 'sep', 'aria-hidden': true }, '·'),
        nameNode(side.path.join(' › '), 'name cp-path')),
      sequence === null ? null : h('div', { class: 'cp-seq' }, 'Sequence ', nameNode(sequence, 'name mono')),
      p === null ? h('div', { class: 'cp-note' }, 'Loading…')
        : !p.ok ? h('div', { class: 'cp-error' }, `Protocol could not be read: ${visibleControls(p.error)}`)
          : p.warnings.length ? h('div', { class: 'cp-warn', title: p.warnings.join('\n') },
            `⚠ ${p.warnings.length} protocol line${p.warnings.length === 1 ? '' : 's'} could not be read`) : null);
  }

  function renderTable() {
    if (!pair) return;
    const { rows, hidden } = diffRows(diffs, { query: filter.value, showNoise: noise.checked });
    hiddenEl.textContent = hidden ? `${hidden} churn/ignored hidden` : '';
    if (loading() || !(protocols[0]?.ok && protocols[1]?.ok)) {
      tableEl.replaceChildren();
      return;
    }
    if (rows.length === 0) {
      const why = diffs.length === 0 ? 'No parameter differs'
        : filter.value.trim() !== '' && hidden === 0 ? 'No differing parameter matches the filter'
          : 'Only churn/ignored parameters differ';
      tableEl.replaceChildren(h('div', { class: 'empty' }, why));
      return;
    }
    tableEl.replaceChildren(h('table', { class: 'diff-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Block'), h('th', { scope: 'col' }, 'Parameter'),
        h('th', { scope: 'col' }, 'A'), h('th', { scope: 'col' }, 'B'))),
      h('tbody', null, rows.map(rowNode))));
  }

  /** @param {DiffRow} r */
  function rowNode(r) {
    return h('tr', { class: `t-${r.tier}` },
      h('td', { class: 'cp-block' }, r.block),
      h('td', { class: 'mono' },
        h('span', { class: 'tier-tag', title: TIER_TITLE[r.tier] }, r.tier), ' ', visibleControls(r.key)),
      valueCell(r.a), valueCell(r.b));
  }

  /** @param {string | null} v */
  const valueCell = (v) => (v === null
    ? h('td', { class: 'absent' }, '(absent = default)')
    : h('td', { class: 'mono pval' }, visibleControls(v)));

  return {
    open,
    close,
    fileClosed: (fileId) => {
      if (pair && (pair.a.file.id === fileId || pair.b.file.id === fileId)) close();
    },
  };
}

// @ts-check
/**
 * The compare panel (adapted from protocols-web ui/comparepanel.js and ui/difftable.js): a
 * bottom drawer comparing the two measurement steps it was opened with, by protocol parameters
 * or by scanner cards. A DOM shell over core/diffview.js and core/cardcompare.js. Header: title,
 * status line, Close; then each step (file, Region › Exam › Program, label, sequence, then the
 * protocol's warnings or the cards' notes, or why it could not be read); then the Parameters |
 * Cards switch, the filter and the current mode's toggle (churn/ignored, or all lines); then the
 * table of differing parameters, or of differing card lines under their tab and card. The mode
 * is kept across opens; the cards are read only once Cards is shown for the pair. The pair is
 * fixed while open: comparing other steps means pressing Compare steps again, which also resets
 * the filter and the toggles. Escape closes it (or first clears the filter).
 */
import { h, nameNode } from './dom.js';
import { visibleControls } from '../core/visible.js';
import { compareStatus, diffRows, sequenceName } from '../core/diffview.js';
import { diffParams } from '../core/paramdiff.js';
import { cardRows, cardStatus, compareCards } from '../core/cardcompare.js';
import { RAW_TITLE, cardNotes, cardsOf, cardTitle } from './cardsview.js';

/** @typedef {import('../core/diffview.js').Side} Side */
/** @typedef {import('../core/diffview.js').DiffRow} DiffRow */
/** @typedef {import('../core/diffview.js').Cell} Cell */
/** @typedef {import('../core/paramdiff.js').ParamDiff} ParamDiff */
/** @typedef {import('../platform/source.js').Protocol} Protocol */
/** @typedef {import('../platform/source.js').ProtocolText} ProtocolText */
/** @typedef {import('../platform/source.js').ProtocolSummary} ProtocolSummary */
/** @typedef {import('../core/cardcompare.js').CardComparison} CardComparison */
/** @typedef {import('../core/cardcompare.js').CardRow} CardRow */
/** @typedef {import('../core/cardcompare.js').CardCell} CardCell */
/** One side's cards, or why they could not be read. @typedef {ReturnType<typeof cardsOf>} SideCards */

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
 *   loadText: (side: Side) => Promise<ProtocolText>,
 *   loadSummary: (side: Side) => Promise<ProtocolSummary>,
 *   onClose: () => void,
 * }} deps the loaders never reject; `onClose` runs when the panel closes and focus has nowhere to return
 * @returns {ComparePanel}
 */
export function createComparePanel(container, { load, loadText, loadSummary, onClose }) {
  /** Kept across opens. @type {'params' | 'cards'} */
  let mode = 'params';
  /** @type {{ a: Side, b: Side } | null} */
  let pair = null;
  /** The two protocols, null while loading. @type {[Protocol | null, Protocol | null]} */
  let protocols = [null, null];
  /** @type {ParamDiff[]} */
  let diffs = [];
  /** The two sides' cards, null until Cards is shown for the pair, each null while loading. @type {[SideCards | null, SideCards | null] | null} */
  let cards = null;
  /** @type {CardComparison | null} */
  let compared = null;
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
  const noiseToggle = h('label', { class: 'cp-toggle', title: 'Churn changes when a protocol is scanned and re-saved; ignored is never meaningful' },
    noise, ' Show churn/ignored');
  const all = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', onChange: () => renderTable() }));
  const allToggle = h('label', { class: 'cp-toggle', title: 'Also list the card lines with the same value on both sides' },
    all, ' Show all lines');
  const paramsBtn = h('button', { type: 'button', class: 'btn btn-small', onClick: () => setMode('params') }, 'Parameters');
  const cardsBtn = h('button', { type: 'button', class: 'btn btn-small', onClick: () => setMode('cards') }, 'Cards');
  const hiddenEl = h('span', { class: 'cp-hidden' });
  const tableEl = h('div', { class: 'cp-table', tabindex: 0, role: 'region', 'aria-label': 'Differing parameters' });
  container.classList.add('compare-panel');
  container.setAttribute('aria-labelledby', 'cp-title');
  container.hidden = true;
  container.replaceChildren(
    h('div', { class: 'cp-head' }, title, statusEl,
      h('button', { type: 'button', class: 'btn btn-small', title: 'Close the comparison (Escape)', onClick: () => close() }, 'Close')),
    sidesEl,
    h('div', { class: 'cp-controls' },
      h('div', { class: 'cp-modes', role: 'group', 'aria-label': 'Compare by' }, paramsBtn, cardsBtn),
      filter, noiseToggle, allToggle, hiddenEl),
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
    cards = null;
    compared = null;
    // Each comparison starts unfiltered, with churn and ignored hidden, and same lines too.
    filter.value = '';
    noise.checked = false;
    all.checked = false;
    container.hidden = false;
    ensureCards();
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
    cards = null;
    compared = null;
    container.hidden = true;
    sidesEl.replaceChildren();
    tableEl.replaceChildren();
    const back = returnFocus;
    returnFocus = null;
    if (back?.isConnected && !back.closest('[hidden]')) back.focus();
    if (back === null || document.activeElement !== back) onClose();
  }

  /** @param {'params' | 'cards'} next */
  function setMode(next) {
    if (next === mode) return;
    mode = next;
    tableEl.scrollTop = 0;
    ensureCards();
    render();
  }

  /** Start reading the pair's cards when Cards is shown and they were not asked for yet. */
  function ensureCards() {
    if (!pair || mode !== 'cards' || cards !== null) return;
    const gen = generation;
    cards = [null, null];
    /** @param {Side} side @returns {Promise<SideCards>} */
    const read = (side) => Promise.all([loadText(side), loadSummary(side)]).then(([t, s]) => cardsOf(t, s));
    void Promise.all([read(pair.a), read(pair.b)]).then(([a, b]) => {
      if (gen !== generation) return;
      cards = [a, b];
      compared = a.ok && b.ok ? compareCards(a.cards, b.cards) : null;
      // Shown when Cards is switched back to.
      if (mode === 'cards') render();
    });
  }

  const loading = () => protocols[0] === null || protocols[1] === null;
  const cardsLoading = () => cards === null || cards[0] === null || cards[1] === null;

  function render() {
    if (!pair) return;
    const { a, b } = pair;
    const sameBlob = a.step.detail.protocolBlob !== null && a.step.detail.protocolBlob === b.step.detail.protocolBlob;
    const [pa, pb] = protocols;
    statusEl.textContent = sameBlob ? compareStatus(true, 0)
      : mode === 'cards' ? (cardsLoading() ? 'Loading cards…'
        : compared ? cardStatus(compared.differ) : 'Could not compare: a protocol could not be read')
        : loading() ? 'Loading protocols…'
          : pa?.ok && pb?.ok ? compareStatus(false, diffs.length)
            : 'Could not compare: a protocol could not be read';
    sidesEl.replaceChildren(sideNode('A', a, pa, cards?.[0] ?? null), sideNode('B', b, pb, cards?.[1] ?? null));
    const byCards = mode === 'cards';
    paramsBtn.setAttribute('aria-pressed', String(!byCards));
    cardsBtn.setAttribute('aria-pressed', String(byCards));
    filter.placeholder = byCards ? 'Filter labels' : 'Filter parameters';
    filter.setAttribute('aria-label', byCards ? 'Filter card lines by label' : 'Filter parameters by name');
    noiseToggle.hidden = byCards;
    allToggle.hidden = !byCards;
    tableEl.setAttribute('aria-label', byCards ? 'Card lines' : 'Differing parameters');
    renderTable();
  }

  /** @param {string} tag @param {Side} side @param {Protocol | null} p @param {SideCards | null} c */
  function sideNode(tag, side, p, c) {
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
      mode === 'cards' ? (c === null ? h('div', { class: 'cp-note' }, 'Loading…')
        : !c.ok ? h('div', { class: 'cp-error' }, visibleControls(c.error))
          : cardNotes(c.cards).map((t) => h('div', { class: 'cp-note' }, t)))
        : p === null ? h('div', { class: 'cp-note' }, 'Loading…')
        : !p.ok ? h('div', { class: 'cp-error' }, `Protocol could not be read: ${visibleControls(p.error)}`)
          : p.warnings.length ? h('details', { class: 'cp-warn' },
            h('summary', null, `⚠ ${p.warnings.length} protocol warning${p.warnings.length === 1 ? '' : 's'}`),
            h('ul', null, p.warnings.map((w) => h('li', null, w)))) : null);
  }

  function renderTable() {
    if (!pair) return;
    if (mode === 'cards') {
      renderCards();
      return;
    }
    const [pa, pb] = protocols;
    if (!(pa?.ok && pb?.ok)) {
      hiddenEl.textContent = '';
      tableEl.replaceChildren();
      return;
    }
    const { rows, hidden, empty } = diffRows(diffs, {
      query: filter.value, showNoise: noise.checked, blocks: { a: pa.blocks.length, b: pb.blocks.length },
    });
    hiddenEl.textContent = hidden ? `${hidden} churn/ignored hidden` : '';
    if (empty !== null) {
      tableEl.replaceChildren(h('div', { class: 'empty' }, empty));
      return;
    }
    tableEl.replaceChildren(h('table', { class: 'diff-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Block'), h('th', { scope: 'col' }, 'Parameter'),
        h('th', { scope: 'col' }, 'A'), h('th', { scope: 'col' }, 'B'))),
      h('tbody', null, rows.map(rowNode))));
  }

  function renderCards() {
    hiddenEl.textContent = '';
    if (!compared) {
      tableEl.replaceChildren();
      return;
    }
    const { header, tabs, empty } = cardRows(compared, { query: filter.value, showAll: all.checked });
    if (empty !== null) {
      tableEl.replaceChildren(h('div', { class: 'empty' }, empty));
      return;
    }
    tableEl.replaceChildren(h('table', { class: 'diff-table cp-cards' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Label'), h('th', { scope: 'col' }, 'A'), h('th', { scope: 'col' }, 'B'))),
      header.length === 0 ? null : group('Header', header.map(cardRowNode)),
      tabs.map((t) => group(t.tab, t.cards.flatMap((c) => {
        const name = cardTitle(t.tab, c.name);
        return [...(name === null ? [] : [h('tr', { class: 'cp-card-row' }, h('td', { colspan: 3 }, visibleControls(name)))]), ...c.rows.map(cardRowNode)];
      })))));
  }

  /**
   * A tab's rows (or the header's) as a row group headed by its name.
   * @param {string} name @param {HTMLElement[]} rows
   */
  function group(name, rows) {
    return h('tbody', null, h('tr', { class: 'cp-tab-row' }, h('th', { colspan: 3, scope: 'rowgroup' }, visibleControls(name))), rows);
  }

  /** @param {CardRow} r */
  function cardRowNode(r) {
    return h('tr', { class: r.same ? 'cp-same' : null }, h('td', null, visibleControls(r.label)), cardCell(r.a), cardCell(r.b));
  }

  /** @param {CardCell | null} c */
  function cardCell(c) {
    if (c === null) return h('td', { class: 'absent' }, '(no line)');
    return h('td', c.raw ? { class: 'pp-card-raw', title: RAW_TITLE } : null,
      c.flag ? h('span', null, '! ') : null, visibleControls(c.text));
  }

  /** @param {DiffRow} r */
  function rowNode(r) {
    return h('tr', { class: `t-${r.tier}` },
      h('td', { class: 'cp-block' }, r.block),
      h('td', { class: 'mono' },
        h('span', { class: 'tier-tag', title: TIER_TITLE[r.tier] }, r.tier), ' ', visibleControls(r.key)),
      valueCell(r.a), valueCell(r.b));
  }

  /** @param {Cell} c */
  function valueCell(c) {
    if (c.kind === 'value') return h('td', { class: 'mono pval' }, visibleControls(c.value));
    return h('td', { class: 'absent' }, c.kind === 'default' ? '(absent = default)' : `(no sub-protocol ${c.block})`);
  }

  return {
    open,
    close,
    fileClosed: (fileId) => {
      if (pair && (pair.a.file.id === fileId || pair.b.file.id === fileId)) close();
    },
  };
}

// @ts-check
/**
 * The Customer sequences report: a bottom drawer listing the sequence and other placeholder
 * references in the measurement protocols of every analyzed file, by category (customer first,
 * the upgrade risk), each with the steps that use it. A DOM shell over core/seqreport.js; the
 * report itself comes from the analyses (src/analysis.js), so the panel reads nothing. Steps
 * whose protocol was not read (or has none, or names no sequence) are listed under Not checked,
 * so a gap never looks clean. A location button shows its step in the active pane. Groups and
 * entries are built on first expand (the standard group can hold thousands of uses). Escape
 * closes it.
 */
import { h, nameNode } from './dom.js';
import { visibleControls } from '../core/visible.js';
import { CATEGORY_LABEL } from '../core/seqrefs.js';
import { GAP_LABEL, customerCounts } from '../core/seqreport.js';
import { reportRows, toCsv, toTsv } from '../core/seqcsv.js';

/** @typedef {import('../core/seqreport.js').SequenceReport} SequenceReport */
/** @typedef {import('../core/seqreport.js').CategoryGroup} CategoryGroup */
/** @typedef {import('../core/seqreport.js').RefEntry} RefEntry */
/** @typedef {import('../core/seqreport.js').ProgramEntry} ProgramEntry */
/** @typedef {import('../core/seqreport.js').Use} Use */
/** @typedef {import('../core/seqreport.js').Gap} Gap */
/** @typedef {import('../analysis.js').AnalysisState} AnalysisState */
/** @typedef {{ name: string, state: AnalysisState }} FileState an open file being or having been analyzed */

/**
 * @typedef {object} SequencePanel
 * @property {() => void} open show the report
 * @property {() => void} close
 * @property {() => boolean} isOpen
 * @property {() => void} refresh re-render when the report or the analyses changed; close when no file is analyzed
 */

const count = (/** @type {number} */ n) => n.toLocaleString('en-US');
const plural = (/** @type {number} */ n, /** @type {string} */ word) => `${count(n)} ${word}${n === 1 ? '' : 's'}`;

/**
 * Fill a `<details>` with `build()` the first time it is open.
 * @param {HTMLElement} details @param {() => HTMLElement[]} build
 */
function lazy(details, build) {
  let filled = false;
  const fill = () => {
    if (filled || !(/** @type {HTMLDetailsElement} */ (details)).open) return;
    filled = true;
    details.append(...build());
  };
  details.addEventListener('toggle', fill);
  fill();
  return details;
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   getReport: () => SequenceReport,
 *   getStates: () => readonly FileState[],
 *   reveal: (stepKey: string) => void,
 *   announce: (text: string) => void,
 *   onClose: () => void,
 * }} deps `getReport` covers every analyzed file and returns the same object until it changes;
 *   `onClose` runs when the panel closes and focus has nowhere to return
 * @returns {SequencePanel}
 */
export function createSequencePanel(container, { getReport, getStates, reveal, announce, onClose }) {
  /** Open state of the shown details by data-id, kept across re-renders while open. @type {Map<string, boolean>} */
  const expanded = new Map();
  /** Which view is shown, kept across re-renders while the page is open. @type {'reference' | 'program'} */
  let view = 'reference';
  /** What the shown render was built from, to skip refreshes that change nothing. */
  let shownStates = '';
  /** @type {HTMLElement | null} */
  let returnFocus = null;
  /** The report shown, null while closed; what Copy and Download CSV export. @type {SequenceReport | null} */
  let shown = null;

  const title = h('h2', { id: 'seq-title', class: 'cp-title', tabindex: -1 }, 'Customer sequences');
  const statusEl = h('div', { class: 'cp-status' });
  const bodyEl = h('div', { class: 'cp-table seq-body', tabindex: 0, role: 'region', 'aria-label': 'Sequence references' });
  const views = /** @type {const} */ ([['reference', 'By reference'], ['program', 'By program']]);
  const viewGroup = h('fieldset', { class: 'seq-views' },
    h('legend', { class: 'sr-only' }, 'Group sequence references'),
    views.map(([value, label]) => h('label', { class: 'cp-toggle' },
      h('input', {
        type: 'radio', name: 'seq-view', value, checked: value === view,
        onChange: () => { view = value; if (!container.hidden) show(false); },
      }), ` ${label}`)));
  const exportButtons = [
    h('button', { type: 'button', class: 'btn btn-small', title: 'Copy every row as tab-separated text for a spreadsheet', onClick: () => void copyRows() }, 'Copy'),
    h('button', { type: 'button', class: 'btn btn-small', title: 'Save every row as a CSV file on this computer', onClick: () => downloadCsv() }, 'Download CSV'),
  ];
  /** @param {SequenceReport | null} report */
  const setShown = (report) => { shown = report; for (const b of exportButtons) /** @type {HTMLButtonElement} */ (b).disabled = report === null; };
  setShown(null);
  container.classList.add('compare-panel', 'seq-panel');
  container.setAttribute('aria-labelledby', 'seq-title');
  container.hidden = true;
  container.replaceChildren(
    h('div', { class: 'cp-head' }, title, statusEl, ...exportButtons,
      h('button', { type: 'button', class: 'btn btn-small', title: 'Close the report (Escape)', onClick: () => close() }, 'Close')),
    h('div', { class: 'cp-controls' }, viewGroup),
    bodyEl);
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });

  const statesKey = () => getStates().map((f) => `${f.name}\0${f.state}`).join('\n');

  function open() {
    if (container.hidden) {
      const active = document.activeElement;
      returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
      container.hidden = false;
    }
    title.focus();
    show(true);
  }

  function close() {
    if (container.hidden) return;
    container.hidden = true;
    setShown(null);
    shownStates = '';
    statusEl.replaceChildren();
    bodyEl.replaceChildren();
    expanded.clear();
    const back = returnFocus;
    returnFocus = null;
    if (back?.isConnected && !back.closest('[hidden]')) back.focus();
    if (back === null || document.activeElement !== back) onClose();
  }

  /**
   * Replace the status and body with `render()`, keeping focus in the panel (on the title)
   * when it was on something replaced, and the details the user opened or closed.
   * @param {() => void} render
   */
  function rerender(render) {
    const active = document.activeElement;
    const had = statusEl.contains(active) || bodyEl.contains(active);
    for (const d of bodyEl.querySelectorAll('details[data-id]')) {
      expanded.set(/** @type {HTMLElement} */ (d).dataset.id ?? '', /** @type {HTMLDetailsElement} */ (d).open);
    }
    render();
    if (had && !container.contains(document.activeElement)) title.focus();
  }

  /** @param {string} id @param {boolean} byDefault */
  const openState = (id, byDefault) => expanded.get(id) ?? byDefault;

  /** Render the current report. @param {boolean} say announce the status */
  function show(say) {
    const report = getReport();
    const states = getStates();
    shownStates = statesKey();
    setShown(report);
    const { references, programs } = customerCounts(report);
    const partial = states.filter((f) => f.state === 'partial').map((f) => visibleControls(f.name));
    const running = states.some((f) => f.state === 'running' || f.state === 'queued');
    const text = `${plural(references, 'customer reference')} in ${plural(programs, 'program')} · ${plural(report.files, 'file')} analyzed`
      + (report.gaps.length ? ` · ${plural(report.gaps.length, 'step')} not checked` : '')
      + (partial.length ? ` · ${partial.join(', ')} ${partial.length === 1 ? 'is' : 'are'} partly analyzed — Analyze ${partial.length === 1 ? 'it' : 'them'} to finish` : '')
      + (running ? ' · analysis running; the report updates when it finishes' : '');
    rerender(() => {
      statusEl.replaceChildren(text);
      bodyEl.replaceChildren(...(report.steps === 0 ? [h('div', { class: 'empty' }, 'No measurement steps')] : [
        ...(view === 'reference' ? report.byReference.map(groupNode) : programsNode(report.byProgram)),
        report.gaps.length ? gapsNode(report.gaps) : null,
      ].filter((n) => n !== null)));
    });
    if (say) announce(`Customer sequences: ${text}`);
  }

  /** Copy the rows as tab-separated text. */
  async function copyRows() {
    if (!shown) return;
    const rows = reportRows(shown);
    try {
      await navigator.clipboard.writeText(toTsv(rows));
      announce(`Copied ${plural(rows.length - 1, 'row')}`);
    } catch (e) {
      const why = e instanceof Error ? e.message : 'clipboard unavailable';
      announce(`Could not copy: ${why}`);
      statusEl.append(' · ', h('span', { class: 'cp-error' }, `Could not copy: ${visibleControls(why)}`));
    }
  }

  /** Save the rows as a local CSV file (BOM for Excel); nothing is uploaded. */
  function downloadCsv() {
    if (!shown) return;
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const url = URL.createObjectURL(new Blob(['\uFEFF' + toCsv(reportRows(shown))], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `customer-sequences-${day}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /** @param {ProgramEntry[]} programs */
  function programsNode(programs) {
    return programs.length === 0 ? [h('div', { class: 'empty' }, 'No program uses a customer or unrecognised reference')]
      : programs.map((p) => {
        const id = `p:${p.programKey}`;
        return lazy(h('details', { class: 'seq-entry seq-program', dataset: { id }, open: openState(id, false) },
          h('summary', null, nameNode([p.fileName, ...p.path].join(' › '), 'name'),
            h('span', { class: 'seq-count' }, plural(p.refs.length, 'reference')))),
        () => p.refs.map((r) => h('div', { class: 'seq-ref' },
          h('div', null, h('span', { class: 'cp-tag seq-cat' }, CATEGORY_LABEL[r.category]), ' ',
            nameNode(r.ref.value, 'name mono seq-value'),
            r.ref.key === 'tSequenceFileName' ? null : h('span', { class: 'seq-key mono' }, visibleControls(r.ref.key))),
          h('ul', { class: 'seq-uses' }, r.uses.map((u) => h('li', null, useButton(u)))))));
      });
  }

  /** @param {CategoryGroup} g */
  function groupNode(g) {
    const id = `g:${g.category}`;
    return lazy(h('details', { class: `seq-group seq-${g.category}`, dataset: { id }, open: openState(id, g.category !== 'standard') },
      h('summary', null, h('span', { class: 'seq-heading' }, `${CATEGORY_LABEL[g.category]} (${count(g.entries.length)})`))),
    () => g.entries.map(entryNode));
  }

  /** @param {RefEntry} e */
  function entryNode(e) {
    const id = `e:${e.category}\0${e.ref.key}\0${e.ref.value}`;
    return lazy(h('details', { class: 'seq-entry', dataset: { id }, open: openState(id, false) },
      h('summary', null, nameNode(e.ref.value, 'name mono seq-value'),
        e.ref.key === 'tSequenceFileName' ? null : h('span', { class: 'seq-key mono' }, visibleControls(e.ref.key)),
        h('span', { class: 'seq-count' }, `${plural(e.uses.length, 'step')} in ${plural(e.programs, 'program')}`))),
    () => [h('ul', { class: 'seq-uses' }, e.uses.map((u) => h('li', null, useButton(u))))]);
  }

  /** @param {Gap[]} gaps */
  function gapsNode(gaps) {
    return h('details', { class: 'seq-group seq-gaps', dataset: { id: 'gaps' }, open: openState('gaps', true) },
      h('summary', null, h('span', { class: 'seq-heading' }, `Not checked (${count(gaps.length)})`)),
      /** @type {[Gap['reason'], string][]} */ (Object.entries(GAP_LABEL)).map(([reason, label]) => {
        const list = gaps.filter((g) => g.reason === reason);
        const id = `x:${reason}`;
        return list.length === 0 ? null : lazy(h('details', { class: 'seq-entry', dataset: { id }, open: openState(id, false) },
          h('summary', null, `${label} (${count(list.length)})`)),
        () => [h('ul', { class: 'seq-uses' }, list.map((g) => h('li', null, useButton(g.use),
          g.error === null ? null : h('span', { class: 'cp-error' }, ` ${visibleControls(g.error)}`))))]);
      }));
  }

  /** A location button: file › region › exam › program › step. @param {Use} u */
  function useButton(u) {
    return h('button', { type: 'button', class: 'seq-loc', onClick: () => reveal(u.stepKey) },
      nameNode([u.fileName, ...u.path].join(' › ')));
  }

  return {
    open,
    close,
    isOpen: () => !container.hidden,
    refresh: () => {
      if (container.hidden) return;
      const report = getReport();
      if (report.files === 0) close();
      else if (report !== shown || statesKey() !== shownStates) show(false);
    },
  };
}

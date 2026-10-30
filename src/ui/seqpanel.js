// @ts-check
/**
 * The analysis reports, one at a time in a bottom drawer. Customer sequences lists the sequence
 * and other placeholder references in the measurement protocols of every analyzed file, by
 * category (customer first, the upgrade risk), each with the steps that use it. Upgrade notes
 * lists each distinct change the protocols' upgrade notes record, by parameter, with the steps it
 * applies to, their conversion dates and sequences, so a physicist can review each change once (the
 * scanner has no bulk find); or by step, program by program, so a technologist can work through
 * the scanner step by step. A DOM shell over core/seqreport.js and core/upgradereport.js; the reports
 * come from the analyses (src/analysis.js), so the panel reads nothing. Steps whose protocol was
 * not read (or has none or is unreadable, or, for Customer sequences, names no sequence) are
 * listed under Not checked, so a gap never looks clean. A location button shows its step in the
 * active pane. Groups and entries are built on first expand (the standard group can hold
 * thousands of uses). Escape closes it.
 */
import { h, nameNode } from './dom.js';
import { visibleControls } from '../core/visible.js';
import { CATEGORY_LABEL } from '../core/seqrefs.js';
import { GAP_LABEL, customerCounts } from '../core/seqreport.js';
import { reportRows, upgradeRows, toCsv, toTsv } from '../core/seqcsv.js';

/** @typedef {import('../core/seqreport.js').SequenceReport} SequenceReport */
/** @typedef {import('../core/seqreport.js').CategoryGroup} CategoryGroup */
/** @typedef {import('../core/seqreport.js').RefEntry} RefEntry */
/** @typedef {import('../core/seqreport.js').ProgramEntry} ProgramEntry */
/** @typedef {import('../core/seqreport.js').Use} Use */
/** @typedef {import('../core/seqreport.js').Gap} Gap */
/** @typedef {import('../core/upgradereport.js').UpgradeReport} UpgradeReport */
/** @typedef {import('../core/upgradereport.js').ChangeEntry} ChangeEntry */
/** @typedef {import('../core/upgradereport.js').ParameterGroup} ParameterGroup */
/** @typedef {import('../core/upgradereport.js').ProgramNotes} ProgramNotes */
/** @typedef {import('../core/upgradenotes.js').ParamChange} ParamChange */
/** @typedef {import('../core/upgradereport.js').StepNotes} StepNotes */
/** @typedef {import('../analysis.js').AnalysisState} AnalysisState */
/** @typedef {{ name: string, state: AnalysisState }} FileState an open file being or having been analyzed */

/** @typedef {'sequences' | 'upgrades'} ReportKind */
/** @typedef {{ kind: 'sequences', report: SequenceReport } | { kind: 'upgrades', report: UpgradeReport }} ShownReport */

/**
 * @typedef {object} SequencePanel
 * @property {(kind: ReportKind) => void} open show that report
 * @property {() => void} close
 * @property {() => boolean} isOpen
 * @property {() => void} refresh re-render when the report or the analyses changed; close when no file is analyzed
 */

/** Each report's title (also the announcement prefix), body label and CSV file name stem. @type {Record<ReportKind, { title: string, label: string, file: string }>} */
const KIND = {
  sequences: { title: 'Customer sequences', label: 'Sequence references', file: 'customer-sequences' },
  upgrades: { title: 'Upgrade notes', label: 'Upgrade notes', file: 'upgrade-notes' },
};

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
 *   getUpgradeReport: () => UpgradeReport,
 *   getStates: () => readonly FileState[],
 *   reveal: (stepKey: string) => void,
 *   announce: (text: string) => void,
 *   onClose: () => void,
 * }} deps `getReport` and `getUpgradeReport` cover every analyzed file and return the same object
 *   until it changes;
 *   `onClose` runs when the panel closes and focus has nowhere to return
 * @returns {SequencePanel}
 */
export function createSequencePanel(container, { getReport, getUpgradeReport, getStates, reveal, announce, onClose }) {
  /** Open state of the shown details by data-id, kept across re-renders while open. @type {Map<string, boolean>} */
  const expanded = new Map();
  /** Which view of Customer sequences is shown, kept while the page is open. @type {'reference' | 'program'} */
  let view = 'reference';
  /** Which view of Upgrade notes is shown, kept while the page is open. @type {'change' | 'step'} */
  let upgradeView = 'change';
  /** Which report is shown, or was last. @type {ReportKind} */
  let kind = 'sequences';
  /** What the shown render was built from, to skip refreshes that change nothing. */
  let shownStates = '';
  /** @type {HTMLElement | null} */
  let returnFocus = null;
  /** The report shown, null while closed; what Copy and Download CSV export. @type {ShownReport | null} */
  let shown = null;

  const title = h('h2', { id: 'seq-title', class: 'cp-title', tabindex: -1 }, KIND[kind].title);
  const statusEl = h('div', { class: 'cp-status' });
  const bodyEl = h('div', { class: 'cp-table seq-body', tabindex: 0, role: 'region', 'aria-label': KIND[kind].label });
  /**
   * A radio group choosing one report's view.
   * @template {string} V
   * @param {string} legend @param {string} name @param {readonly (readonly [V, string])[]} views
   * @param {V} initial @param {(value: V) => void} set
   */
  const viewGroup = (legend, name, views, initial, set) => h('fieldset', { class: 'seq-views' },
    h('legend', { class: 'sr-only' }, legend),
    views.map(([value, label]) => h('label', { class: 'cp-toggle' },
      h('input', {
        type: 'radio', name, value, checked: value === initial,
        onChange: () => { set(value); if (!container.hidden) show(false); },
      }), ` ${label}`)));
  /** Each kind's view choice; only the shown kind's is visible. @type {Record<ReportKind, HTMLElement>} */
  const viewGroups = {
    sequences: viewGroup('Group sequence references', 'seq-view',
      /** @type {const} */ ([['reference', 'By reference'], ['program', 'By program']]), view, (v) => { view = v; }),
    upgrades: viewGroup('Group upgrade notes', 'upgrade-view',
      /** @type {const} */ ([['change', 'By change'], ['step', 'By step']]), upgradeView, (v) => { upgradeView = v; }),
  };
  const exportButtons = [
    h('button', { type: 'button', class: 'btn btn-small', title: 'Copy every row as tab-separated text for a spreadsheet', onClick: () => void copyRows() }, 'Copy'),
    h('button', { type: 'button', class: 'btn btn-small', title: 'Save every row as a CSV file on this computer', onClick: () => downloadCsv() }, 'Download CSV'),
  ];
  /** @param {ShownReport | null} report */
  const setShown = (report) => { shown = report; for (const b of exportButtons) /** @type {HTMLButtonElement} */ (b).disabled = report === null; };
  const controls = h('div', { class: 'cp-controls' }, viewGroups.sequences, viewGroups.upgrades);
  setShown(null);
  container.classList.add('compare-panel', 'seq-panel');
  container.setAttribute('aria-labelledby', 'seq-title');
  container.hidden = true;
  container.replaceChildren(
    h('div', { class: 'cp-head' }, title, statusEl, ...exportButtons,
      h('button', { type: 'button', class: 'btn btn-small', title: 'Close the report (Escape)', onClick: () => close() }, 'Close')),
    controls,
    bodyEl);
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });

  const statesKey = () => getStates().map((f) => `${f.name}\0${f.state}`).join('\n');

  /** @param {ReportKind} next */
  function open(next) {
    if (next !== kind) {
      kind = next;
      expanded.clear();
      bodyEl.replaceChildren();
    }
    title.textContent = KIND[kind].title;
    bodyEl.setAttribute('aria-label', KIND[kind].label);
    viewGroups.sequences.hidden = kind !== 'sequences';
    viewGroups.upgrades.hidden = kind !== 'upgrades';
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

  /** The current kind's report. @returns {ShownReport} */
  const current = () => (kind === 'sequences'
    ? { kind: 'sequences', report: getReport() }
    : { kind: 'upgrades', report: getUpgradeReport() });

  /** The status after a report's own counts: gaps, partly analyzed files, a running analysis. @param {readonly Gap[]} gaps */
  function statusSuffix(gaps) {
    const states = getStates();
    const partial = states.filter((f) => f.state === 'partial').map((f) => visibleControls(f.name));
    const running = states.some((f) => f.state === 'running' || f.state === 'queued');
    return (gaps.length ? ` · ${plural(gaps.length, 'step')} not checked` : '')
      + (partial.length ? ` · ${partial.join(', ')} ${partial.length === 1 ? 'is' : 'are'} partly analyzed — Analyze ${partial.length === 1 ? 'it' : 'them'} to finish` : '')
      + (running ? ' · analysis running; the report updates when it finishes' : '');
  }

  /** Render the current report. @param {boolean} say announce the status */
  function show(say) {
    const s = current();
    shownStates = statesKey();
    setShown(s);
    const { text, body } = s.kind === 'sequences' ? sequencesView(s.report) : upgradesView(s.report);
    rerender(() => {
      statusEl.replaceChildren(text);
      bodyEl.replaceChildren(...body());
    });
    if (say) announce(`${KIND[s.kind].title}: ${text}`);
  }

  /**
   * The status text, and the body to build inside rerender (after it saved the open details).
   * @param {SequenceReport} report @returns {{ text: string, body: () => HTMLElement[] }}
   */
  function sequencesView(report) {
    const { references, programs } = customerCounts(report);
    return {
      text: `${plural(references, 'customer reference')} in ${plural(programs, 'program')} · ${plural(report.files, 'file')} analyzed`
        + statusSuffix(report.gaps),
      body: () => (report.steps === 0 ? [h('div', { class: 'empty' }, 'No measurement steps')] : [
        ...(view === 'reference' ? report.byReference.map(groupNode) : programsNode(report.byProgram)),
        report.gaps.length ? gapsNode(report.gaps) : null,
      ].filter((n) => n !== null)),
    };
  }

  /** As sequencesView. @param {UpgradeReport} report @returns {{ text: string, body: () => HTMLElement[] }} */
  function upgradesView(report) {
    const unlisted = report.byStep.filter((s) => s.conversions.every((c) => c.changes.length === 0));
    return {
      text: `${plural(report.byChange.length, 'distinct change')} on ${plural(report.byStep.length, 'step')} in ${plural(report.programs, 'program')} · ${plural(report.files, 'file')} analyzed`
        + statusSuffix(report.gaps),
      body: () => (report.steps === 0 ? [h('div', { class: 'empty' }, 'No measurement steps')] : [
        ...(report.byStep.length === 0 ? [h('div', { class: 'empty' }, 'No analyzed protocol has upgrade notes')]
          : upgradeView === 'change' ? report.byParameter.map(parameterNode) : report.byProgram.map(programNotesNode)),
        unlisted.length ? unlistedNode(unlisted) : null,
        report.gaps.length ? gapsNode(report.gaps) : null,
      ].filter((n) => n !== null)),
    };
  }

  /** @param {ShownReport} s */
  const rowsOf = (s) => (s.kind === 'sequences' ? reportRows(s.report) : upgradeRows(s.report));

  /** Copy the rows as tab-separated text. */
  async function copyRows() {
    if (!shown) return;
    const rows = rowsOf(shown);
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
    const url = URL.createObjectURL(new Blob(['\uFEFF' + toCsv(rowsOf(shown))], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `${KIND[shown.kind].file}-${day}.csv` });
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

  /** A parameter's changes. @param {ParameterGroup} g */
  function parameterNode(g) {
    const id = `p:${g.parameter ?? ''}`;
    return lazy(h('details', { class: 'seq-group seq-parameter', dataset: { id }, open: openState(id, false) },
      h('summary', null, g.parameter === null ? h('span', { class: 'seq-heading' }, 'Other lines') : nameNode(g.parameter, 'name seq-heading'), ' ',
        h('span', { class: 'seq-count' }, `${plural(g.changes.length, 'change')} on ${plural(g.steps, 'step')} in ${plural(g.programs, 'program')}`))),
    () => g.changes.map(changeNode));
  }

  /** A program's steps, each with its conversions and their changes. @param {ProgramNotes} p */
  function programNotesNode(p) {
    const id = `s:${p.fileId}\0${p.programKey}`;
    return lazy(h('details', { class: 'seq-entry seq-program seq-upgrade-program', dataset: { id }, open: openState(id, false) },
      h('summary', null, nameNode([p.fileName, ...p.path].join(' › '), 'name'), ' ',
        h('span', { class: 'seq-count' }, plural(p.steps.length, 'step')))),
    () => [h('ul', { class: 'seq-uses' }, p.steps.map((s) => h('li', null, useButton(s.use),
      s.use.sequence === null ? null : ' ', s.use.sequence === null ? null : h('span', { class: 'seq-key mono' }, visibleControls(s.use.sequence)),
      s.conversions.map((c) => h('div', { class: 'seq-conv' },
        c.date === null ? null : h('span', { class: 'seq-dates' }, `${visibleControls(c.date)}:`), c.date === null ? null : ' ',
        c.changes.length === 0 ? h('span', { class: 'seq-empty' }, 'No changes listed')
          : c.changes.flatMap((ch, i) => [i === 0 ? null : ' · ', ch.parameter === null ? nameNode(ch.text, 'name seq-value')
            : h('span', null, nameNode(ch.parameter), ': ', diffNode(ch))]))))))]);
  }

  /** A change's old → new value and unit. @param {ParamChange} c */
  function diffNode(c) {
    return h('span', { class: 'mono seq-diff' },
      c.from === '' ? h('span', { class: 'seq-empty' }, '(empty)') : visibleControls(c.from),
      ` → ${visibleControls(c.to)}`, c.unit === '' ? '' : ` ${visibleControls(c.unit)}`);
  }

  /** A distinct change: parameter, old → new value and unit (or the line), then its steps. @param {ChangeEntry} e */
  function changeNode(e) {
    const c = e.change;
    const id = `c:${c.text}`;
    return lazy(h('details', { class: 'seq-entry seq-change', dataset: { id }, open: openState(id, false) },
      h('summary', null, ...(c.parameter === null ? [nameNode(c.text, 'name seq-value')] : [
        h('span', { class: 'seq-heading' }, nameNode(c.parameter), ':'), ' ', diffNode(c),
      ]), ' ',
      h('span', { class: 'seq-count' }, `${plural(e.uses.length, 'step')} in ${plural(e.programs, 'program')}`))),
    () => [h('ul', { class: 'seq-uses' }, e.uses.map((u) => {
      const dates = u.dates.filter((d) => d !== null);
      return h('li', null, useButton(u.use),
        dates.length ? ' ' : null, dates.length ? h('span', { class: 'seq-dates' }, `converted ${dates.map(visibleControls).join(', ')}`) : null,
        u.use.sequence === null ? null : ' ', u.use.sequence === null ? null : h('span', { class: 'seq-key mono' }, visibleControls(u.use.sequence)));
    }))]);
  }

  /** Steps whose upgrade notes list no change. @param {StepNotes[]} steps */
  function unlistedNode(steps) {
    return lazy(h('details', { class: 'seq-group', dataset: { id: 'unlisted' }, open: openState('unlisted', false) },
      h('summary', null, h('span', { class: 'seq-heading' }, `No changes listed (${count(steps.length)})`))),
    () => [h('ul', { class: 'seq-uses' }, steps.map((s) => h('li', null, useButton(s.use))))]);
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
      const { report } = current();
      if (report.files === 0) close();
      else if (report !== shown?.report || statesKey() !== shownStates) show(false);
    },
  };
}

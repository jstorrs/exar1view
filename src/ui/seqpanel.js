// @ts-check
/**
 * The Customer sequences panel: a bottom drawer listing the sequence and other placeholder
 * references in the measurement protocols of every open file, by category (customer first, the
 * upgrade risk), each with the steps that use it. A DOM shell over core/seqscan.js and
 * core/seqreport.js. Protocols are read only when the panel is opened (or Scan is pressed), into
 * an in-memory cache kept while the page is open, so a later open reads only what is missing.
 * Steps whose protocol was not read (or has none, or names no sequence) are listed under Not
 * checked, so a gap never looks clean. A
 * location button shows its step in the active pane. Groups and entries are built on first
 * expand (the standard group can hold thousands of uses). Escape closes it. The steps and
 * containers marked as using customer or unrecognised references (core/seqmarks.js) go to
 * `onMarks` whenever a report is shown (scan finished or cancelled) and when Close stops a scan;
 * closing a file just drops its keys.
 */
import { h, nameNode } from './dom.js';
import { visibleControls } from '../core/visible.js';
import { CATEGORY_LABEL } from '../core/seqrefs.js';
import { buildReport, GAP_LABEL } from '../core/seqreport.js';
import { NO_MARKS, markedKeys } from '../core/seqmarks.js';
import { reportRows, toCsv, toTsv } from '../core/seqcsv.js';
import { protocolBlobs, scanProtocols } from '../core/seqscan.js';

/** @typedef {import('../core/model.js').ExarFile} ExarFile */
/** @typedef {import('../core/workspace.js').Workspace} Workspace */
/** @typedef {import('../core/seqrefs.js').ProtocolRefs} ProtocolRefs */
/** @typedef {import('../core/seqreport.js').SequenceReport} SequenceReport */
/** @typedef {import('../core/seqreport.js').CategoryGroup} CategoryGroup */
/** @typedef {import('../core/seqreport.js').RefEntry} RefEntry */
/** @typedef {import('../core/seqreport.js').ProgramEntry} ProgramEntry */
/** @typedef {import('../core/seqreport.js').Use} Use */
/** @typedef {import('../core/seqreport.js').Gap} Gap */
/** @typedef {import('../platform/source.js').ProtocolText} ProtocolText */

/**
 * @typedef {object} SequencePanel
 * @property {() => void} open show the panel, reading the protocols not read yet
 * @property {() => void} close
 * @property {() => boolean} isOpen
 * @property {(fileId: string) => void} fileClosed forget that file's protocols (call before closing its source)
 * @property {() => void} refresh re-render when the open files changed (not while reading)
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
 *   getWorkspace: () => Workspace,
 *   readText: (fileId: string, blob: string) => Promise<ProtocolText>,
 *   reveal: (stepKey: string) => void,
 *   announce: (text: string) => void,
 *   onClose: () => void,
 *   onMarks: (marks: ReadonlySet<string>) => void,
 * }} deps `readText` never rejects; `onClose` runs when the panel closes and focus has nowhere to return
 * @returns {SequencePanel}
 */
export function createSequencePanel(container, { getWorkspace, readText, reveal, announce, onClose, onMarks }) {
  /** Scan results by file id, then protocol blob; kept while the page is open. @type {Map<string, Map<string, ProtocolRefs>>} */
  const cache = new Map();
  /** The running scan's controller, null when idle. @type {AbortController | null} */
  let controller = null;
  /** Whether the last scan was cancelled and left protocols unread. */
  let cancelled = false;
  /** Open state of the shown details by data-id, kept across re-renders while open. @type {Map<string, boolean>} */
  const expanded = new Map();
  /** Which view is shown, kept across re-renders while the page is open. @type {'reference' | 'program'} */
  let view = 'reference';
  /** The open file ids the shown report was built from. */
  let shownIds = '';
  /** @type {HTMLElement | null} */
  let returnFocus = null;
  /** The report shown, null while scanning or closed; what Copy and Download CSV export. @type {SequenceReport | null} */
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
        onChange: () => { view = value; if (controller === null) show(false); },
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
      h('button', { type: 'button', class: 'btn btn-small', title: 'Close the list (Escape)', onClick: () => close() }, 'Close')),
    h('div', { class: 'cp-controls' }, viewGroup),
    bodyEl);
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });

  const fileIds = () => getWorkspace().files.map((f) => f.id).join('\0');
  /** The keys last sent to `onMarks`. @type {ReadonlySet<string>} */
  let marks = NO_MARKS;
  /** @param {ReadonlySet<string>} next */
  const setMarks = (next) => { marks = next; onMarks(next); };
  /** Send the keys `report` marks. @param {SequenceReport} report */
  const mark = (report) => setMarks(markedKeys(getWorkspace(), report));
  /** @param {ExarFile} f */
  const unscanned = (f) => protocolBlobs(f).some((b) => !cache.get(f.id)?.has(b));

  function open() {
    if (container.hidden) {
      const active = document.activeElement;
      returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
      container.hidden = false;
    }
    title.focus();
    if (controller) return;
    if (getWorkspace().files.some(unscanned)) void scan(getWorkspace().files);
    else show(true);
  }

  function close() {
    if (container.hidden) return;
    // Closing stops a scan and keeps what was read, so the marks show it.
    if (controller !== null) {
      controller.abort();
      controller = null;
      mark(buildReport(getWorkspace().files, cache));
    }
    container.hidden = true;
    setShown(null);
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

  /** Read the protocols of `files` missing from the cache, then show the report. @param {readonly ExarFile[]} files */
  async function scan(files) {
    const ctrl = new AbortController();
    controller = ctrl;
    const cancel = h('button', {
      type: 'button', class: 'btn btn-small', onClick: () => {
        // Show the partial result now; the in-flight read is dropped when it resolves.
        ctrl.abort();
        controller = null;
        cancelled = true;
        show(true);
      },
    }, 'Cancel');
    setShown(null);
    const progress = h('span', null, 'Reading protocols…');
    rerender(() => {
      statusEl.replaceChildren(progress, ' ', cancel);
      bodyEl.replaceChildren(h('div', { class: 'empty' }, 'Reading protocols…'));
    });
    announce('Reading protocols');
    const result = await scanProtocols({
      files, cache, readText, signal: ctrl.signal,
      onProgress: ({ done, total }) => { progress.textContent = `Reading protocols: ${count(done)} / ${count(total)}`; },
    });
    // Closed, or restarted by fileClosed: that one shows its own result.
    if (controller !== ctrl) return;
    controller = null;
    cancelled = result === 'cancelled';
    show(true);
  }

  /** Build the report from the cache and render it. @param {boolean} say announce the status */
  function show(say) {
    const files = getWorkspace().files;
    shownIds = fileIds();
    const report = buildReport(files, cache);
    setShown(report);
    mark(report);
    const customer = report.byReference.find((g) => g.category === 'customer')?.entries ?? [];
    const programs = new Set(customer.flatMap((e) => e.uses.map((u) => `${u.fileId}\0${u.programKey}`))).size;
    const missing = files.filter(unscanned).length;
    if (missing === 0) cancelled = false;
    const text = `${plural(customer.length, 'customer reference')} in ${plural(programs, 'program')} · ${plural(report.files, 'file')}`
      + (report.gaps.length ? ` · ${plural(report.gaps.length, 'step')} not checked` : '')
      + (cancelled ? ' (cancelled; results are partial)' : '');
    rerender(() => {
      statusEl.replaceChildren(text, ...(missing ? [
        ` · ${count(missing)} open file${missing === 1 ? '' : 's'} not scanned — `,
        h('button', { type: 'button', class: 'btn btn-small', onClick: () => void scan(getWorkspace().files) }, 'Scan'),
      ] : []));
      bodyEl.replaceChildren(...(report.steps === 0 ? [h('div', { class: 'empty' }, 'No measurement steps')] : [
        ...(view === 'reference' ? report.byReference.map(groupNode) : programsNode(report.byProgram)),
        report.gaps.length ? gapsNode(report.gaps) : null,
      ].filter((n) => n !== null)));
    });
    if (say) announce(`Customer sequences: ${text}${missing ? `; ${count(missing)} not scanned` : ''}`);
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
    fileClosed: (fileId) => {
      const running = controller !== null;
      controller?.abort();
      controller = null;
      cache.delete(fileId);
      // Its keys carry its id; the rest stay until the restarted scan (if any) shows its report.
      setMarks(new Set([...marks].filter((k) => !k.startsWith(`${fileId}:`))));
      // The workspace still holds the file: rescan the others, resuming from the cache.
      if (running) void scan(getWorkspace().files.filter((f) => f.id !== fileId));
    },
    refresh: () => {
      if (container.hidden) return;
      if (getWorkspace().files.length === 0) close();
      else if (controller === null && fileIds() !== shownIds) show(false);
    },
  };
}

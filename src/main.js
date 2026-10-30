// @ts-check
/**
 * Bootstrap (imperative shell): owns the workspace (the loaded files), the
 * file queue, each loaded file's open database (its protocols are read on
 * demand), the two panes (one, or two side by side in split view), the
 * selection store, the per-file analyses (src/analysis.js, in memory only), the compare panels
 * and the Customer sequences report. Files opened or dropped load one after another; a loaded
 * file joins the dropdowns and is shown only by a pane that had no file. The file menu, Problems
 * and Close act on the pane they were opened from; Compare steps acts on the steps selected in
 * the shown panes and Compare programs on the programs selected in the two panes of split view.
 * Analyze reads every protocol and add-in of one file (the active pane's, or the file menu's),
 * one file at a time; afterwards the panes mark what uses customer sequences and name add-ins,
 * and the file menu opens the report over every analyzed file, which shows its steps in the
 * active pane. One of the three views is open at a time.
 */

import { loadSqlJs, openDb } from './platform/sqlite.js';
import { inflateRaw } from './platform/inflate.js';
import { createFileSource } from './platform/source.js';
import { errorText } from './core/errors.js';
import { loadExar } from './core/load.js';
import { visibleControls } from './core/visible.js';
import {
  EMPTY_WORKSPACE, addFile, removeFile, nextFileId, findDuplicate, fileById, fileProblems, programProblems,
  locateProblems,
} from './core/workspace.js';
import { COMPARE_HINT, measurementPair } from './core/diffview.js';
import { PROGRAM_COMPARE_HINT, programPair } from './core/progdiffview.js';
import { createSelectionStore, shownSelection, shownPrograms } from './store.js';
import { createPane } from './ui/pane.js';
import { createComparePanel } from './ui/comparepanel.js';
import { createProgramCompare } from './ui/programcompare.js';
import { createSequencePanel } from './ui/seqpanel.js';
import { createAnalyses } from './analysis.js';
import { customerCounts } from './core/seqreport.js';
import { NO_ADDINS } from './core/stepinfo.js';
import { NO_KEYS } from './core/seqmarks.js';
import { openMenu } from './ui/menu.js';
import { problemsDialog } from './ui/dialogs.js';
import { installFileDrop } from './ui/filedrop.js';
import { h } from './ui/dom.js';

/** @typedef {import('./core/workspace.js').Workspace} Workspace */
/** @typedef {import('./ui/pane.js').Pane} Pane */
/** @typedef {import('./platform/sqlite.js').SqlJs} SqlJs */
/** @typedef {import('./platform/source.js').FileSource} FileSource */
/** @typedef {import('./analysis.js').AnalysisEvent} AnalysisEvent */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const statusEl = $('status');
const announceEl = $('announce');
const banner = $('errors');
const appEl = $('app');
const emptyEl = $('empty-state');
const openBtn = $('open');
const splitBtn = $('split-view');
const compareBtn = /** @type {HTMLButtonElement} */ ($('compare'));
const compareProgramsBtn = /** @type {HTMLButtonElement} */ ($('compare-programs'));
const analyzeBtn = /** @type {HTMLButtonElement} */ ($('analyze'));
const analysisEl = $('analysis');
const analysisProgressEl = $('analysis-progress');
const analysisCancelBtn = $('analysis-cancel');
const markCustomBtn = $('mark-custom');
const markUpgradeBtn = $('mark-upgrade');
const fileInput = /** @type {HTMLInputElement} */ ($('file-input'));

/** @type {Workspace} */
let ws = EMPTY_WORKSPACE;
/** Selected steps per pane, for features that act on them. */
const selection = createSelectionStore();
/** Each loaded file's protocols, by file id; closing the file closes it. @type {Map<string, FileSource>} */
const sources = new Map();

// ---------------------------------------------------------------- errors and status

// Error banner: built once; reports append items so the alert region persists.
const errorList = h('ul');
banner.append(errorList, h('button', {
  type: 'button', class: 'btn',
  onClick: () => { errorList.replaceChildren(); banner.hidden = true; focusActive(); },
}, 'Dismiss'));

/** @param {string} message */
function showError(message) {
  errorList.append(h('li', null, message));
  banner.hidden = false;
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let statusTimer;
/**
 * @param {string} text
 * @param {boolean} [transient] clear it after a few seconds
 */
function setStatus(text, transient = false) {
  clearTimeout(statusTimer);
  statusEl.textContent = text;
  if (transient) statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 5000);
}

/**
 * Say something to screen readers (the visual status box is not a live region,
 * so progress ticks are not read out).
 * @param {string} text
 */
function announce(text) {
  announceEl.textContent = text;
}

// ---------------------------------------------------------------- analyses

const closed = Promise.resolve({ ok: /** @type {const} */ (false), error: 'the file is closed' });

/** Whether the panes show customer-sequence marks (Mark customer sequences; this session only). */
let showCustom = true;
/** Whether the panes show upgrade-note marks (Mark upgrade notes; this session only). */
let showUpgrade = false;

// Before the panes: they read the marks while being created.
const analyses = createAnalyses({
  getWorkspace: () => ws,
  readText: (id, blob) => sources.get(id)?.text(blob) ?? closed,
  readAddIn: (id, blob) => sources.get(id)?.addIn(blob) ?? closed,
  onProgress: () => updateProgress(),
  onChange: analysisChanged,
  onError: analysisFailed,
});

// ---------------------------------------------------------------- panes

let split = false;
let activeIndex = 0;
const hosts = [
  h('div', { class: 'pane-host', role: 'region', 'aria-label': 'Pane', hidden: true }),
  h('div', { class: 'pane-host', role: 'region', 'aria-label': 'Right pane', hidden: true }),
];
appEl.append(...hosts);

/** @type {Pane[]} */
const panes = [];
const activePane = () => panes[activeIndex];
for (const i of /** @type {const} */ ([0, 1])) {
  panes.push(createPane(hosts[i], {
    getWorkspace: () => ws,
    getProtocol: (id, blob) => sources.get(id)?.protocol(blob) ?? closed,
    getProtocolText: (id, blob) => sources.get(id)?.text(blob) ?? closed,
    getSummary: (id, blob) => sources.get(id)?.summary(blob) ?? closed,
    getAddInText: (id, blob) => sources.get(id)?.addInText(blob) ?? closed,
    getMarks: () => shownMarks(),
    getAddIns: (id) => analyses.published(id)?.addIns ?? NO_ADDINS,
    label: i === 0 ? '' : 'right pane',
    // Also called while the pane is being created, before it is in `panes`.
    onChange: () => {
      selection.setSteps(i, panes[i]?.selectedSteps() ?? []);
      selection.setProgram(i, panes[i]?.selectedProgram() ?? null);
      if (panes[activeIndex]) updateAnalyze();
    },
    onContextMenu: (at, returnFocus, where) => { activate(i); openFileMenu(at, returnFocus, where); },
    onActivate: () => activate(i),
    onProblems: showProblems,
    onProgramProblems: showProgramProblems,
    onCloseFile: closeFile,
  }));
}
/** Too narrow for the protocol beside the program; keep in step with app.css. */
const narrow = matchMedia('(max-width: 1230px)');
/** The protocol beside the program is for the one-pane view on a wide enough window. */
const updateProtocolShown = () => panes[0].setProtocolShown(!split && !narrow.matches);
updateProtocolShown();
narrow.addEventListener('change', updateProtocolShown);

function focusActive() {
  if (programCompare.isOpen()) programCompare.focus();
  else if (ws.files.length) activePane().focus(); else openBtn.focus();
}

/** @param {number} i */
function activate(i) {
  if (i === activeIndex) return;
  activeIndex = i;
  hosts.forEach((host, j) => host.classList.toggle('active', split && j === i));
  updateAnalyze();
}

/**
 * Show the panes or the empty state and bring both panes up to date (the
 * hidden one too, so it lets go of closed files).
 */
function render() {
  const empty = ws.files.length === 0;
  emptyEl.hidden = !empty;
  hosts[0].hidden = empty;
  hosts[1].hidden = empty || !split;
  panes.forEach((p) => p.render());
  updateCompare();
  updateProgramCompare();
  updateAnalyze();
  updateProgress();
  seqPanel.refresh();
}

/** @param {Workspace} next */
function setWorkspace(next) {
  ws = next;
  render();
}

/** @param {boolean} on */
function setSplit(on) {
  split = on;
  appEl.classList.toggle('split', on);
  hosts[0].setAttribute('aria-label', on ? 'Left pane' : 'Pane');
  panes[0].setLabel(on ? 'left pane' : '');
  updateProtocolShown();
  splitBtn.setAttribute('aria-pressed', String(on));
  if (on && panes[1].fileId() === panes[0].fileId()) {
    // A second pane on the same file is rarely wanted: start it on another one.
    const other = ws.files.find((f) => f.id !== panes[0].fileId());
    if (other) panes[1].showFile(other.id);
  }
  if (!on && activeIndex === 1) {
    const hadFocus = hosts[1].contains(document.activeElement);
    activate(0);
    if (hadFocus) panes[0].focus();
  }
  hosts.forEach((host, j) => host.classList.toggle('active', on && j === activeIndex));
  selection.setSplit(on);
  render();
}

// ---------------------------------------------------------------- file actions

/** @param {string} fileId */
function showProblems(fileId) {
  const file = fileById(ws, fileId);
  if (!file) return;
  void problemsDialog({ title: `Problems in ${visibleControls(file.name)}`, problems: fileProblems(ws, file) });
}

/**
 * A program's problems, with `where` as a label path like the file's list has.
 * @param {import('./core/model.js').Program} program
 */
function showProgramProblems(program) {
  void problemsDialog({
    title: `Problems in ${visibleControls(program.label)}`, problems: locateProblems(ws, programProblems(program)),
  });
}

/** @param {string} fileId */
function closeFile(fileId) {
  const file = fileById(ws, fileId);
  if (!file) return;
  const showing = panes.map((p) => p.fileId() === fileId);
  comparePanel.fileClosed(fileId);
  programCompare.fileClosed(fileId);
  analyses.fileClosed(fileId);
  sources.get(fileId)?.close();
  sources.delete(fileId);
  setWorkspace(removeFile(ws, fileId));
  // In split view a pane that showed it moves to a file the other pane is not showing.
  panes.forEach((p, i) => {
    const other = split ? panes[1 - i].fileId() : null;
    const next = ws.files.find((f) => f.id !== other);
    if (showing[i] && next) p.showFile(next.id);
  });
  setStatus(`Closed ${visibleControls(file.name)}`, true);
  announce(`Closed ${visibleControls(file.name)}`);
  const f = document.activeElement;
  if (!(f instanceof HTMLElement) || f === document.body || f.closest('[hidden]') || /** @type {any} */ (f).disabled) {
    focusActive();
  }
}

/**
 * Context menu of the active pane's file; over the step list it also offers Compare steps
 * and over the tree Compare programs, when that is possible.
 * @param {{x:number, y:number}} at
 * @param {HTMLElement} returnFocus
 * @param {'tree' | 'steps'} where
 */
function openFileMenu(at, returnFocus, where) {
  const file = fileById(ws, activePane().fileId());
  if (!file) return;
  const n = fileProblems(ws, file).length;
  const compare = where === 'steps' && selectedPair() !== null;
  const comparePrograms = where === 'tree' && selectedPrograms() !== null;
  const state = analyses.state(file.id);
  /** @type {import('./ui/menu.js').MenuEntry[]} */
  const analysis = [
    ...(state === 'none' || state === 'partial' ? [{ label: 'Analyze', run: () => startAnalysis(file.id) }] : []),
    ...(state === 'queued' || state === 'running' ? [{ label: 'Cancel analysis', run: () => analyses.cancel(file.id) }] : []),
    ...(anyAnalyzed() ? [{ label: 'Customer sequences report', run: openReport }] : []),
  ];
  openMenu(at, [
    ...(compare ? [{ label: 'Compare steps', run: openCompare }, /** @type {const} */ ('separator')] : []),
    ...(comparePrograms ? [{ label: 'Compare programs', run: openProgramCompare }, /** @type {const} */ ('separator')] : []),
    ...(analysis.length ? [...analysis, /** @type {const} */ ('separator')] : []),
    ...(n ? [{ label: `Problems (${n})…`, run: () => showProblems(file.id) }] : []),
    { label: 'Close file', run: () => closeFile(file.id) },
  ], { label: `File ${visibleControls(file.name)}`, returnFocus });
}

// ---------------------------------------------------------------- compare

/**
 * Read a compare side's protocol through `read`, or say why it cannot be.
 * @template T
 * @param {import('./core/diffview.js').Side} side
 * @param {(source: FileSource, blob: string) => Promise<T>} read
 * @returns {Promise<T | { ok: false, error: string }>}
 */
function readSide(side, read) {
  const blob = side.step.detail.protocolBlob;
  if (blob === null) return Promise.resolve({ ok: false, error: 'the step has no protocol' });
  const source = sources.get(side.file.id);
  return source ? read(source, blob) : Promise.resolve({ ok: false, error: 'the file is closed' });
}

const comparePanel = createComparePanel($('compare-panel'), {
  load: (side) => readSide(side, (s, blob) => s.protocol(blob)),
  loadText: (side) => readSide(side, (s, blob) => s.text(blob)),
  loadSummary: (side) => readSide(side, (s, blob) => s.summary(blob)),
  onClose: focusActive,
});

/** The two measurement steps selected in the shown panes, if that is what is selected. */
const selectedPair = () => measurementPair(ws, shownSelection(selection.get()));

function updateCompare() {
  const ok = selectedPair() !== null;
  compareBtn.setAttribute('aria-disabled', String(!ok));
  compareBtn.title = ok ? 'Compare the two selected measurement steps' : COMPARE_HINT;
}

function openCompare() {
  const pair = selectedPair();
  if (pair) {
    switchView({ close: () => { programCompare.close(); seqPanel.close(); } }, () => comparePanel.open(pair));
  } else {
    setStatus(COMPARE_HINT, true);
    announce(COMPARE_HINT);
  }
}

// Its Compare steps buttons open the step drawer under it, which closes with it.
const programCompare = createProgramCompare($('program-compare'), {
  cover: appEl, announce, onClose: focusActive,
  compareSteps: (pair) => comparePanel.open(pair),
  closeSteps: () => comparePanel.close(),
});

/**
 * Close the other compare view and then open a view, which should return focus to where the
 * press came from, not to where the closing view's own press came from.
 * @param {{ close: () => void }} other
 * @param {() => void} open
 */
function switchView(other, open) {
  const invoker = document.activeElement;
  other.close();
  if (invoker instanceof HTMLElement && invoker.isConnected && !invoker.closest('[hidden]')) invoker.focus();
  open();
}

/** The two programs selected in the panes of split view, if that is what is selected. */
const selectedPrograms = () => programPair(ws, shownPrograms(selection.get()));

function updateProgramCompare() {
  const ok = selectedPrograms() !== null;
  compareProgramsBtn.setAttribute('aria-disabled', String(!ok));
  compareProgramsBtn.title = ok ? 'Compare the two programs selected in the panes of split view' : PROGRAM_COMPARE_HINT;
}

function openProgramCompare() {
  const pair = selectedPrograms();
  if (pair) {
    switchView({ close: () => { comparePanel.close(); seqPanel.close(); } }, () => programCompare.open(pair));
  } else {
    setStatus(PROGRAM_COMPARE_HINT, true);
    announce(PROGRAM_COMPARE_HINT);
  }
}

// ---------------------------------------------------------------- analyze and the report

// A drawer under the panes, which stay shown: its location buttons navigate the active pane.
const seqPanel = createSequencePanel($('sequence-report'), {
  getReport: () => analyses.report(),
  getStates: () => ws.files.flatMap((f) => {
    const state = analyses.state(f.id);
    return state === 'none' ? [] : [{ name: f.name, state }];
  }),
  reveal: (key) => activePane().reveal(key),
  announce,
  onClose: focusActive,
});

/** The marks the panes draw: each kind only while its header toggle is on. */
function shownMarks() {
  const m = analyses.marks();
  return { custom: showCustom ? m.custom : NO_KEYS, upgrade: showUpgrade ? m.upgrade : NO_KEYS };
}

/** @param {boolean} on */
function setShowCustom(on) {
  showCustom = on;
  markCustomBtn.setAttribute('aria-pressed', String(on));
  panes.forEach((p) => p.render());
}

/** @param {boolean} on */
function setShowUpgrade(on) {
  showUpgrade = on;
  markUpgradeBtn.setAttribute('aria-pressed', String(on));
  panes.forEach((p) => p.render());
}

/** @param {string} fileId */
const fileName = (fileId) => visibleControls(fileById(ws, fileId)?.name ?? 'the file');

/** Whether the Analyze button can act, and its title (the reason when it cannot). */
function analyzeState() {
  const file = fileById(ws, activePane().fileId());
  if (!file) return { ok: false, title: 'Open a file to analyze it' };
  const name = visibleControls(file.name);
  switch (analyses.state(file.id)) {
    case 'none': return { ok: true, title: `Read every protocol and add-in of ${name} to mark customer sequences, find upgrade notes and name add-ins (can take a minute)` };
    case 'partial': return { ok: true, title: `Finish analyzing ${name} (the last analysis stopped early)` };
    case 'queued': case 'running': return { ok: false, title: `${name} is being analyzed` };
    case 'done': return { ok: false, title: `${name} is analyzed; right-click it for its Customer sequences report` };
  }
}

function updateAnalyze() {
  const { ok, title } = analyzeState();
  analyzeBtn.setAttribute('aria-disabled', String(!ok));
  analyzeBtn.title = title;
}

function pressAnalyze() {
  const { ok, title } = analyzeState();
  const id = activePane().fileId();
  if (ok && id) {
    startAnalysis(id);
  } else {
    setStatus(title, true);
    announce(title);
  }
}

/** @param {string} fileId */
function startAnalysis(fileId) {
  analyses.start(fileId);
}

/** How many open files wait for their analysis. */
const queuedCount = () => ws.files.filter((f) => analyses.state(f.id) === 'queued').length;

/**
 * Show the running analysis next to the button, or hide it when idle. A queued file counts as
 * busy, so the strip (and focus on its Cancel) stays between one file's end and the next's start.
 */
function updateProgress() {
  const run = analyses.running();
  if (run) {
    const more = run.queued ? ` (${count(run.queued)} more queued)` : '';
    analysisProgressEl.textContent = `Analyzing ${fileName(run.fileId)}: ${count(run.done)} / ${count(run.total)} documents${more}`;
    analysisEl.hidden = false;
  } else if (queuedCount() > 0) {
    if (analysisEl.hidden) analysisProgressEl.textContent = 'Starting analysis…';
    analysisEl.hidden = false;
  } else if (!analysisEl.hidden) {
    const hadFocus = analysisEl.contains(document.activeElement);
    analysisEl.hidden = true;
    analysisProgressEl.textContent = '';
    if (hadFocus) analyzeBtn.focus();
  }
}

/** Bring everything that shows analysis results up to date. @param {boolean} panesToo */
function analysisUpdated(panesToo) {
  if (panesToo) panes.forEach((p) => p.render());
  updateAnalyze();
  updateProgress();
  seqPanel.refresh();
}

/** Announcements made in this task, read out together so a later one does not cut off an earlier one. @type {string[]} */
const sayings = [];
/** @param {string} text */
function say(text) {
  if (sayings.push(text) > 1) return;
  queueMicrotask(() => announce(sayings.splice(0).join(' ')));
}

/** While Cancel stops every analysis: it announces once for all of them. */
let cancellingAll = false;

function cancelAllAnalyses() {
  const run = analyses.running();
  const queued = queuedCount();
  cancellingAll = true;
  try {
    analyses.cancelAll();
  } finally {
    cancellingAll = false;
  }
  const parts = [
    ...(run ? [`Analysis of ${fileName(run.fileId)} cancelled; what was read is kept.`] : []),
    ...(queued ? [`${plural(queued, 'queued file')} will not be analyzed.`] : []),
  ];
  if (parts.length) say(parts.join(' '));
}

/** @param {string} fileId @param {AnalysisEvent} e */
function analysisChanged(fileId, e) {
  const name = fileName(fileId);
  analysisUpdated(e === 'done' || e === 'cancelled');
  if (e === 'queued') {
    const run = analyses.running();
    if (run && run.fileId !== fileId) say(`${name} will be analyzed after ${fileName(run.fileId)}`);
  } else if (e === 'started') {
    say(`Analyzing ${name}`);
  } else if (e === 'done') {
    const published = analyses.published(fileId);
    const { references, programs } = published ? customerCounts(published.report) : { references: 0, programs: 0 };
    const text = `Analyzed ${name}: ${plural(references, 'customer reference')} in ${plural(programs, 'program')}; ${plural(published?.upgrades.size ?? 0, 'protocol')} with upgrade notes.`;
    const full = `${text} Right-click the file for its Customer sequences report.`;
    setStatus(full, true);
    say(full);
  } else if (cancellingAll) {
    // cancelAllAnalyses announces these together.
  } else if (e === 'cancelled') {
    say(`Analysis of ${name} cancelled; what was read is kept.`);
  } else if (e === 'dequeued') {
    say(`${name} will not be analyzed.`);
  }
}

/**
 * A run that failed (or an analysis callback that threw): no event follows, and the file is
 * already settled (what was read published), so bring the panes, button, progress and report up
 * to date. Never throws back into the controller.
 * @param {string} fileId @param {unknown} error
 */
function analysisFailed(fileId, error) {
  const name = fileName(fileId);
  try {
    showError(`Analyzing ${name}: ${errorText(error)}`);
    say(`Could not analyze ${name}`);
    analysisUpdated(true);
  } catch (again) {
    showError(`After analyzing ${name}: ${errorText(again)}`);
  }
}

/** Whether some open file has analysis results, which the report covers. */
const anyAnalyzed = () => ws.files.some((f) => analyses.published(f.id) !== null);

function openReport() {
  if (anyAnalyzed()) {
    switchView({ close: () => { programCompare.close(); comparePanel.close(); } }, () => seqPanel.open());
  }
}

// ---------------------------------------------------------------- loading

/** Files waiting to load, in order; a drop while loading adds to it. @type {File[]} */
const queue = [];
let draining = false;

const count = (/** @type {number} */ n) => n.toLocaleString('en-US');
const plural = (/** @type {number} */ n, /** @type {string} */ word) => `${count(n)} ${word}${n === 1 ? '' : 's'}`;

/** @param {File[]} files */
function enqueue(files) {
  queue.push(...files);
  if (!draining) void drain();
}

async function drain() {
  draining = true;
  try {
    /** @type {SqlJs} */
    let SQL;
    try {
      SQL = await loadSqlJs();
    } catch (err) {
      showError(`SQLite engine: ${errorText(err)}`);
      queue.length = 0;
      setStatus('');
      return;
    }
    let note = '';
    for (let file = queue.shift(); file; file = queue.shift()) {
      const name = visibleControls(file.name);
      try {
        note = await loadOne(SQL, file, name);
      } catch (err) {
        showError(`${name}: ${errorText(err)}`);
        note = `Could not read ${name}`;
      }
      announce(note);
    }
    setStatus(note, true);
  } finally {
    draining = false;
  }
}

/**
 * Load one file into the workspace. Throws only on unexpected errors.
 * @param {SqlJs} SQL
 * @param {File} file
 * @param {string} name the file name for messages
 * @returns {Promise<string>} what happened, for the status line
 */
async function loadOne(SQL, file, name) {
  const source = { name: file.name, size: file.size, lastModified: file.lastModified };
  if (findDuplicate(ws, source)) return `${name} is already open`;
  const more = () => (queue.length ? ` (${count(queue.length)} more queued)` : '');
  setStatus(`Reading ${name}…${more()}`);
  announce(`Reading ${name}`);
  /** @type {Awaited<ReturnType<typeof loadExar>>} */
  let result;
  const id = nextFileId(ws);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const opened = openDb(SQL, bytes);
    // A loaded file keeps its database open for its protocols; any other ends here.
    let keep = false;
    try {
      result = await loadExar(opened.db, inflateRaw, { id, name: file.name, size: file.size }, (p) => {
        setStatus(p.phase === 'head'
          ? `Reading ${name}: head…${more()}`
          : `Reading ${name}: ${count(p.done)}/${count(p.total)} documents${more()}`);
      });
      keep = result.ok;
    } finally {
      if (keep) sources.set(id, createFileSource(opened, inflateRaw)); else opened.close();
    }
  } catch (err) {
    result = { ok: false, error: errorText(err) };
  }
  if (!result.ok) {
    showError(`${name}: ${result.error}`);
    return `Could not read ${name}`;
  }
  setWorkspace(addFile(ws, result.file, source));
  // A pane without a file has just picked this one up; the others keep theirs.
  return panes.some((p) => p.fileId() === id) ? `Opened ${name}` : `Added ${name}`;
}

openBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files ?? [])];
  fileInput.value = '';
  enqueue(files);
});
installFileDrop(enqueue);
splitBtn.addEventListener('click', () => setSplit(!split));
compareBtn.addEventListener('click', openCompare);
compareProgramsBtn.addEventListener('click', openProgramCompare);
analyzeBtn.addEventListener('click', pressAnalyze);
analysisCancelBtn.addEventListener('click', cancelAllAnalyses);
markCustomBtn.addEventListener('click', () => setShowCustom(!showCustom));
markUpgradeBtn.addEventListener('click', () => setShowUpgrade(!showUpgrade));
selection.subscribe(updateCompare);
selection.subscribe(updateProgramCompare);
render();

// Start the SQLite engine early and show its version once it is ready.
loadSqlJs().then(
  (SQL) => {
    const db = new SQL.Database();
    try {
      const version = db.exec('select sqlite_version()')[0].values[0][0];
      $('sqlite-version').textContent = `SQLite ${version}`;
    } finally {
      db.close();
    }
  },
  (/** @type {unknown} */ err) => showError(`SQLite engine: ${errorText(err)}`),
);

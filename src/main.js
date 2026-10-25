// @ts-check
/**
 * Bootstrap (imperative shell): owns the workspace (the loaded files), the
 * file queue, each loaded file's open database (its protocols are read on
 * demand), the two panes (one, or two side by side in split view), the
 * selection store and the compare panel. Files opened or dropped load one
 * after another; a loaded file joins the dropdowns and is shown only by a pane
 * that had no file. The file menu, Problems and Close act on the pane they were
 * opened from; Compare steps acts on the steps selected in the shown panes and
 * Compare programs on the programs selected in the two panes of split view.
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
import { openMenu } from './ui/menu.js';
import { problemsDialog } from './ui/dialogs.js';
import { installFileDrop } from './ui/filedrop.js';
import { h } from './ui/dom.js';

/** @typedef {import('./core/workspace.js').Workspace} Workspace */
/** @typedef {import('./ui/pane.js').Pane} Pane */
/** @typedef {import('./platform/sqlite.js').SqlJs} SqlJs */
/** @typedef {import('./platform/source.js').FileSource} FileSource */

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
for (const i of /** @type {const} */ ([0, 1])) {
  panes.push(createPane(hosts[i], {
    getWorkspace: () => ws,
    label: i === 0 ? '' : 'right pane',
    // Also called while the pane is being created, before it is in `panes`.
    onChange: () => {
      selection.setSteps(i, panes[i]?.selectedSteps() ?? []);
      selection.setProgram(i, panes[i]?.selectedProgram() ?? null);
    },
    onContextMenu: (at, returnFocus, where) => { activate(i); openFileMenu(at, returnFocus, where); },
    onActivate: () => activate(i),
    onProblems: showProblems,
    onProgramProblems: showProgramProblems,
    onCloseFile: closeFile,
  }));
}
const activePane = () => panes[activeIndex];

function focusActive() {
  if (programCompare.isOpen()) programCompare.focus();
  else if (ws.files.length) activePane().focus(); else openBtn.focus();
}

/** @param {number} i */
function activate(i) {
  if (i === activeIndex) return;
  activeIndex = i;
  hosts.forEach((host, j) => host.classList.toggle('active', split && j === i));
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
  openMenu(at, [
    ...(compare ? [{ label: 'Compare steps', run: openCompare }, /** @type {const} */ ('separator')] : []),
    ...(comparePrograms ? [{ label: 'Compare programs', run: openProgramCompare }, /** @type {const} */ ('separator')] : []),
    ...(n ? [{ label: `Problems (${n})…`, run: () => showProblems(file.id) }] : []),
    { label: 'Close file', run: () => closeFile(file.id) },
  ], { label: `File ${visibleControls(file.name)}`, returnFocus });
}

// ---------------------------------------------------------------- compare

const comparePanel = createComparePanel($('compare-panel'), {
  load: (side) => {
    const blob = side.step.detail.protocolBlob;
    if (blob === null) return Promise.resolve({ ok: false, error: 'the step has no protocol' });
    return sources.get(side.file.id)?.protocol(blob) ?? Promise.resolve({ ok: false, error: 'the file is closed' });
  },
  onClose: focusActive,
});

/** The two measurement steps selected in the shown panes, if that is what is selected. */
const selectedPair = () => measurementPair(ws, shownSelection(selection.get()));

function updateCompare() {
  const ok = selectedPair() !== null;
  compareBtn.setAttribute('aria-disabled', String(!ok));
  compareBtn.title = ok ? 'Compare the protocol parameters of the two selected measurement steps' : COMPARE_HINT;
}

function openCompare() {
  const pair = selectedPair();
  if (pair) {
    switchView(programCompare, () => comparePanel.open(pair));
  } else {
    setStatus(COMPARE_HINT, true);
    announce(COMPARE_HINT);
  }
}

const programCompare = createProgramCompare($('program-compare'), { cover: appEl, announce, onClose: focusActive });

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
    switchView(comparePanel, () => programCompare.open(pair));
  } else {
    setStatus(PROGRAM_COMPARE_HINT, true);
    announce(PROGRAM_COMPARE_HINT);
  }
}

// ---------------------------------------------------------------- loading

/** Files waiting to load, in order; a drop while loading adds to it. @type {File[]} */
const queue = [];
let draining = false;

const count = (/** @type {number} */ n) => n.toLocaleString('en-US');

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

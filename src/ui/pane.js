// @ts-check
/**
 * One explorer pane: left nav (file dropdown, file actions, search, 3-level
 * tree) and a right side (breadcrumb and the selected program). A thin
 * DOM shell over src/core: tree state transitions are pure functions in
 * treeview.js; the program view (programpane.js) keeps its own selection. Read-only:
 * the pane only draws and forwards events; closing a file and showing its
 * problems are the caller's.
 *
 * The shell elements are built once. Tree rows are rebuilt only when the
 * workspace, file, expansion or query change; a selection-only change just
 * moves classes/ARIA between existing elements. Delegated listeners on the
 * tree find their target through data-key.
 */
import { h, isTextField, nameNode, problemWord, reconcileChildren, warnMarker } from './dom.js';
import { createProgramPane } from './programpane.js';
import { filterFile } from '../core/search.js';
import { fileById, fileProblems, lookup, labelPath } from '../core/workspace.js';
import {
  initialState, isExpandedFn, buildRows, reconcile, anchorKey, keyToAction, applyAction,
  selectFile, setQuery,
} from '../core/treeview.js';
import { visibleControls } from '../core/visible.js';

/** @typedef {import('../core/model.js').ExarFile} ExarFile */
/** @typedef {import('../core/workspace.js').Workspace} Workspace */
/** @typedef {import('../core/search.js').Filter} Filter */
/** @typedef {import('../core/treeview.js').Row} Row */
/** @typedef {import('../core/treeview.js').ViewState} ViewState */
/** @typedef {import('../core/treeview.js').Action} Action */
/** @typedef {import('./dom.js').Keyed} Keyed */
/** @typedef {import('./dom.js').KeyedSpec} KeyedSpec */
/**
 * @typedef {object} Pane
 * @property {() => void} render re-read the workspace and bring the DOM up to date (also while
 *   hidden, so a closed file is released)
 * @property {(fileId: string) => void} showFile switch to a file
 * @property {() => string | null} fileId the shown file
 * @property {(label: string) => void} setLabel see PaneDeps.label
 * @property {() => string[]} selectedSteps selected step keys in list order
 * @property {() => void} focus focus the tree or the step list, whichever was last active
 */
/**
 * @typedef {object} PaneDeps
 * @property {() => Workspace} getWorkspace
 * @property {string} label added to the accessible names of the pane's parts ("left pane"), or ''
 * @property {() => void} [onChange] tree or step selection, or the shown file, changed
 * @property {(at: {x:number, y:number}, returnFocus: HTMLElement, where: 'tree' | 'steps') => void} [onContextMenu]
 *   `where`: opened over the tree (or the file dropdown) or over the step list
 * @property {() => void} [onActivate] the pane got focus or a pointer press
 * @property {(fileId: string) => void} [onProblems] show a file's problems
 * @property {(program: import('../core/model.js').Program) => void} [onProgramProblems] show a program's problems
 * @property {(fileId: string) => void} [onCloseFile]
 */

const LEVEL_LABEL = ['', 'region', 'exam', 'program'];
/** @type {ReadonlySet<string>} */
const NO_MATCHES = new Set();
let paneCounter = 0;

/**
 * Dropdown text of each file: its name, plus its id when another open file has the same name.
 * @param {readonly ExarFile[]} files
 * @returns {string[]}
 */
function fileLabels(files) {
  return files.map((f) => {
    const name = visibleControls(f.name);
    return files.some((g) => g !== f && g.name === f.name) ? `${name} (${f.id})` : name;
  });
}

/**
 * @param {HTMLElement} container
 * @param {PaneDeps} deps
 * @returns {Pane}
 */
export function createPane(container, {
  getWorkspace, label: initialLabel, onChange = () => {}, onContextMenu = () => {}, onActivate = () => {},
  onProblems = () => {}, onProgramProblems = () => {}, onCloseFile = () => {},
}) {
  const id = `pane${++paneCounter}`;
  let label = initialLabel;
  /** An accessible name, with the pane's label when it has one. @param {string} what */
  const named = (what) => (label ? `${what} (${label})` : what);
  /** @type {ViewState} */
  let state = initialState();
  /** @type {readonly Row[]} */
  let rows = [];
  /** @type {Map<string, HTMLElement>} */
  let rowEls = new Map();
  /** @type {HTMLElement | null} */
  let selectedEl = null;
  /** @type {'tree'|'list'} */
  let active = 'tree';
  // Keyed element reuse across rebuilds (see reconcileChildren).
  /** @type {Map<string, Keyed>} */
  let treeKeyed = new Map();
  /** Stable element id per node key (see idOf). @type {Map<string, string>} */
  const elementIds = new Map();
  let idCounter = 0;

  // What the DOM currently reflects, to decide what to rebuild.
  /** @type {Workspace | null} */ let builtWs = null;
  /** @type {ViewState | null} */ let builtState = null;
  let builtOptions = '';
  let builtCrumbs = '';
  /** @type {{file: ExarFile|null, query: string, result: Filter|null}} */
  let filterCache = { file: null, query: '', result: null };
  /** @type {{file: ExarFile|null, count: number}} */
  let problemCache = { file: null, count: 0 };
  /** Last tree/list selection reported through onChange. */
  let reported = '';

  const select = /** @type {HTMLSelectElement} */ (h('select', {
    class: 'tree-select',
    onChange: () => apply(selectFile(state, select.value)),
    onContextmenu: (/** @type {MouseEvent} */ e) => {
      e.preventDefault();
      onContextMenu({ x: e.clientX, y: e.clientY }, select, 'tree');
    },
  }));
  const problemsBtn = /** @type {HTMLButtonElement} */ (h('button', {
    type: 'button', class: 'btn btn-small', hidden: true,
    onClick: () => { if (state.fileId) onProblems(state.fileId); },
  }));
  const closeBtn = /** @type {HTMLButtonElement} */ (h('button', {
    type: 'button', class: 'btn btn-small', title: 'Close this file',
    onClick: () => { if (state.fileId) onCloseFile(state.fileId); },
  }, 'Close file'));
  const search = /** @type {HTMLInputElement} */ (h('input', {
    type: 'search', class: 'search', placeholder: 'Search', autocomplete: 'off',
    spellcheck: false,
    onInput: () => apply(setQuery(getWorkspace(), state, search.value)),
    onKeydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape' && search.value !== '') {
        e.preventDefault();
        e.stopPropagation();
        search.value = '';
        apply(setQuery(getWorkspace(), state, ''));
      }
    },
  }));
  const treeEl = h('div', {
    class: 'tree', role: 'tree', tabindex: 0,
    onKeydown: onTreeKey, onClick: onTreeClick, onContextmenu: onTreeMenu,
    onFocusin: () => { active = 'tree'; },
  });
  const crumbEl = h('nav', { class: 'crumbs' });
  const steps = createProgramPane({
    onChange: () => report(),
    onContextMenu: (at, returnFocus) => onContextMenu(at, returnFocus, 'steps'),
    onProblems: (program) => onProgramProblems(program),
  });
  steps.el.addEventListener('focusin', () => { active = 'list'; });
  container.addEventListener('pointerdown', () => onActivate(), true);
  container.addEventListener('focusin', () => onActivate());
  container.replaceChildren(h('div', { class: 'pane' },
    h('section', { class: 'nav' }, select,
      h('div', { class: 'file-actions' }, problemsBtn, closeBtn),
      h('div', { class: 'search-wrap' }, search),
      treeEl),
    h('section', { class: 'content' }, crumbEl, steps.el)));

  function setNames() {
    select.setAttribute('aria-label', named('File'));
    search.setAttribute('aria-label', named('Search names'));
    treeEl.setAttribute('aria-label', named('Protocols'));
    crumbEl.setAttribute('aria-label', named('Breadcrumb'));
  }
  setNames();

  /** Tell the caller when the shown file or the selections changed. */
  function report() {
    const now = JSON.stringify([state.fileId, state.selected, steps.selected()]);
    if (now === reported) return;
    reported = now;
    onChange();
  }

  /** Filter result, cached per (file object, query). @param {ExarFile | null} file */
  function getFilter(file) {
    if (!file) {
      filterCache = { file: null, query: '', result: null };
      return null;
    }
    if (filterCache.file !== file || filterCache.query !== state.query) {
      filterCache = { file, query: state.query, result: filterFile(file, state.query) };
    }
    return filterCache.result;
  }

  /** @param {ViewState} next @param {boolean} [scrollToSelection] */
  function apply(next, scrollToSelection = true) {
    state = next;
    refresh(scrollToSelection);
  }

  /** Bring the DOM up to date with workspace + state, doing the least work. @param {boolean} scrollToSelection */
  function refresh(scrollToSelection) {
    const ws = getWorkspace();
    state = reconcile(ws, state);
    const file = fileById(ws, state.fileId);
    if (ws !== builtWs) forgetClosed(ws);

    const labels = fileLabels(ws.files);
    const optionsSig = JSON.stringify(ws.files.map((f, i) => [f.id, labels[i]]));
    if (optionsSig !== builtOptions) {
      builtOptions = optionsSig;
      select.replaceChildren(...ws.files.map((f, i) => h('option', { value: f.id }, labels[i])));
    }
    select.value = state.fileId ?? '';
    select.disabled = file === null;
    closeBtn.disabled = file === null;
    if (problemCache.file !== file) problemCache = { file, count: file ? fileProblems(ws, file).length : 0 };
    problemsBtn.hidden = problemCache.count === 0;
    problemsBtn.textContent = `Problems (${problemCache.count})`;
    problemsBtn.title = `Show the ${problemWord(problemCache.count)} found while reading this file`;

    const filter = getFilter(file);
    const fileChanged = state.fileId !== builtState?.fileId;
    const rebuild = ws !== builtWs || !builtState || fileChanged
      || state.expanded !== builtState.expanded || state.overrides !== builtState.overrides
      || state.query !== builtState.query;
    if (rebuild) rebuildTree(file, filter, fileChanged);

    const anchor = anchorKey(ws, rows, state.selected);
    syncSelection(anchor);
    renderContent(ws, file, filter);

    builtWs = ws;
    builtState = state;
    if (scrollToSelection || fileChanged) {
      const el = anchor === null ? null : rowEls.get(anchor);
      el?.scrollIntoView({ block: 'nearest' });
    }
    report();
  }

  /** @param {ExarFile | null} file @param {Filter | null} filter @param {boolean} resetScroll */
  function rebuildTree(file, filter, resetScroll) {
    const top = treeEl.scrollTop;
    rows = file ? buildRows(file, isExpandedFn(state, filter), filter) : [];
    if (selectedEl) {
      selectedEl.classList.remove('selected', 'anchor');
      selectedEl.setAttribute('aria-selected', 'false');
      selectedEl = null;
    }
    if (rows.length === 0) {
      treeEl.replaceChildren(h('div', { class: 'empty' }, file ? (filter ? 'No matches' : 'Empty tree') : 'No file'));
      treeKeyed = new Map();
    } else {
      treeKeyed = reconcileChildren(treeEl, rows.map(rowSpec), treeKeyed);
    }
    rowEls = new Map(rows.map((r) => [r.key, /** @type {Keyed} */ (treeKeyed.get(r.key)).el]));
    treeEl.scrollTop = resetScroll ? 0 : top;
  }

  /** Stable element id per node key, so reused elements keep theirs. @param {string} key */
  function idOf(key) {
    let v = elementIds.get(key);
    if (v === undefined) { v = `${id}-t${++idCounter}`; elementIds.set(key, v); }
    return v;
  }

  /** Drop element ids of closed files. @param {Workspace} ws */
  function forgetClosed(ws) {
    const open = new Set(ws.files.map((f) => f.id));
    for (const key of elementIds.keys()) if (!open.has(key.slice(0, key.indexOf(':')))) elementIds.delete(key);
  }

  /** @param {Row} row @returns {KeyedSpec} */
  function rowSpec(row) {
    const hasMatch = row.hasMatch && state.query !== '';
    const what = `${LEVEL_LABEL[row.level]}, ${row.count} ${row.level === 3 ? 'steps' : 'items'}`;
    const extra = [row.hits ? `${row.hits} matching step${row.hits === 1 ? '' : 's'}` : '',
      row.problems ? problemWord(row.problems) : ''].filter(Boolean).map((w) => `, ${w}`).join('');
    return {
      key: row.key,
      sig: JSON.stringify([row.label, row.level, row.count, row.expandable, row.expanded, row.match, hasMatch, row.hits, row.problems]),
      build: () => h('div', {
        id: idOf(row.key),
        class: ['row', `lvl-${row.level}`, row.match && 'match', hasMatch && 'has-match'].filter(Boolean).join(' '),
        role: 'treeitem',
        'aria-level': row.level,
        'aria-selected': false,
        'aria-expanded': row.expandable ? row.expanded : null,
        'aria-label': `${visibleControls(row.label)}, ${what}${extra}`,
        dataset: { key: row.key },
      },
        h('span', { class: 'chev' + (row.expandable ? ' toggle' : ''), 'aria-hidden': true },
          row.expandable ? (row.expanded ? '▾' : '▸') : ''),
        nameNode(row.label),
        row.problems ? warnMarker(row.problems) : null,
        row.hits ? h('span', { class: 'hits', title: `${row.hits} matching step${row.hits === 1 ? '' : 's'}`, 'aria-hidden': true },
          `${row.hits} ⌕`) : null,
        h('span', { class: 'count', 'aria-hidden': true }, row.count)),
    };
  }

  /**
   * Style the anchor row: `.selected` + aria-selected when it is the selection
   * itself, `.anchor` (no aria-selected) when it only contains a hidden selection.
   * @param {string | null} anchor
   */
  function syncSelection(anchor) {
    const el = anchor === null ? null : rowEls.get(anchor) ?? null;
    const isSelection = el !== null && anchor === state.selected;
    if (selectedEl) {
      selectedEl.classList.remove('selected', 'anchor');
      selectedEl.setAttribute('aria-selected', 'false');
    }
    if (el) {
      el.classList.add(isSelection ? 'selected' : 'anchor');
      el.setAttribute('aria-selected', String(isSelection));
    }
    selectedEl = el;
    if (el) treeEl.setAttribute('aria-activedescendant', el.id);
    else treeEl.removeAttribute('aria-activedescendant');
  }

  /**
   * Right side: breadcrumb (file, then the selection's labels) and the selected
   * program.
   * @param {Workspace} ws @param {ExarFile | null} file @param {Filter | null} filter
   */
  function renderContent(ws, file, filter) {
    const loc = state.selected === null ? undefined : lookup(ws, state.selected);
    const names = file ? [visibleControls(file.name), ...(loc ? labelPath(loc) : [])] : [];
    const crumbSig = JSON.stringify(names);
    if (builtCrumbs !== crumbSig) {
      builtCrumbs = crumbSig;
      crumbEl.title = names.join(' › ');
      crumbEl.replaceChildren(...names.flatMap((n, i) => [
        ...(i > 0 ? [h('span', { class: 'sep', 'aria-hidden': true }, '›')] : []),
        nameNode(n, 'crumb'),
      ]));
    }
    const program = loc?.level === 'program' ? loc.node : null;
    steps.show({
      program,
      matches: filter?.matches ?? NO_MATCHES,
      emptyText: file ? 'Select a program to see its steps' : '',
      name: named(program ? `Steps of ${visibleControls(program.label)}` : 'Steps'),
    });
  }

  /** @param {Action} action */
  function dispatch(action) {
    const ws = getWorkspace();
    apply(applyAction(ws, state, getFilter(fileById(ws, state.fileId)), action));
  }

  /** @param {MouseEvent} e */
  function onTreeClick(e) {
    const target = /** @type {Element} */ (e.target);
    const rowEl = /** @type {HTMLElement | null} */ (target.closest('[role=treeitem]'));
    if (!rowEl?.dataset.key) return;
    dispatch({ type: target.closest('.chev.toggle') ? 'toggle' : 'select', key: rowEl.dataset.key });
    treeEl.focus();
  }

  /** @param {KeyboardEvent} e */
  function onTreeKey(e) {
    if (isTextField(e.target)) return;
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); menuAtSelection(); return; }
    // Ctrl+A would select the page's text; the tree has a single selection, so it is a no-op.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); return; }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const action = keyToAction(e.key, rows, anchorKey(getWorkspace(), rows, state.selected));
    if (action === null) return;
    e.preventDefault();
    dispatch(action);
  }

  /** @param {MouseEvent} e */
  function onTreeMenu(e) {
    e.preventDefault();
    const rowEl = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[role=treeitem]'));
    if (rowEl?.dataset.key) {
      // The menu is about the file, so the selection stays as it is.
      treeEl.focus();
      onContextMenu({ x: e.clientX, y: e.clientY }, treeEl, 'tree');
    } else if (e.target === treeEl) {
      // Keyboard-originated (focus is on the tree itself), or the empty area below the rows.
      menuAtSelection();
    }
  }

  /** Open the context menu next to the selected row (keyboard). */
  function menuAtSelection() {
    const r = (selectedEl ?? treeEl).getBoundingClientRect();
    onContextMenu({ x: r.left + 24, y: r.top + Math.min(r.height, 28) }, treeEl, 'tree');
  }

  refresh(false);
  return {
    render: () => refresh(false),
    showFile: (fileId) => apply(selectFile(state, fileId), false),
    fileId: () => state.fileId,
    setLabel: (next) => {
      if (next === label) return;
      label = next;
      setNames();
      refresh(false);
    },
    selectedSteps: () => steps.selected(),
    focus: () => (active === 'list' ? steps.focus() : treeEl.focus()),
  };
}

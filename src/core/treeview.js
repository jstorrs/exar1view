// @ts-check
/**
 * Pure view logic for the explorer tree: visible rows, expansion under a
 * filter, selection reconciliation and key -> action mapping. The pane is a
 * thin DOM shell over these functions.
 */
import { displaySteps, isTreeKey } from './model.js';
import { fileById, lookup, programProblems } from './workspace.js';

/** @typedef {import('./model.js').ExarFile} ExarFile */
/** @typedef {import('./workspace.js').Workspace} Workspace */
/** @typedef {import('./search.js').Filter} Filter */
/** @typedef {import('./seqmarks.js').Marks} Marks */
/** @typedef {string} ContainerKey  tree, region, exam or program key */
/**
 * One tree row. `level` is its depth (a file with several trees puts its
 * regions under tree rows, one level deeper). `count` is the number of
 * children (steps for a program); `hits` the program's matching steps under a
 * search; `problems` the program's problems (its own and its steps'); `custom` that a
 * scan found customer or unrecognised sequences in it, `upgrade` protocols with upgrade notes
 * (see seqmarks.js).
 * @typedef {{key:ContainerKey, kind:'tree'|'region'|'exam'|'program', level:1|2|3|4, label:string, count:number,
 *   expandable:boolean, expanded:boolean,
 *   parentKey:ContainerKey|null, match:boolean, hasMatch:boolean, hits:number, problems:number, custom:boolean,
 *   upgrade:boolean}} Row
 */
/**
 * Local UI state of one pane. Treated as immutable: every function returns a
 * new state (sharing unchanged parts), so identity comparison detects change.
 * `expanded` is the user's own expansion; `collapsed` the trees the user
 * closed (trees are open by default). While a filter is active, the
 * displayed expansion is the user's plus the filter's auto-expansion, with
 * `overrides` (user toggles made during this filter) taking precedence;
 * overrides are discarded whenever the query changes.
 * @typedef {{fileId:string|null, expanded:ReadonlySet<ContainerKey>, collapsed:ReadonlySet<ContainerKey>,
 *   overrides:ReadonlyMap<ContainerKey, boolean>, selected:ContainerKey|null, query:string}} ViewState
 */
/** @typedef {{type:'select'|'expand'|'collapse'|'toggle', key:ContainerKey} | {type:'none'}} Action */

/** @returns {ViewState} */
export function initialState() {
  return { fileId: null, expanded: new Set(), collapsed: new Set(), overrides: new Map(), selected: null, query: '' };
}

/**
 * The user's own expansion of a container: trees are open unless collapsed,
 * the rest closed unless expanded.
 * @param {ViewState} state
 * @param {ContainerKey} key
 */
const userOpen = (state, key) => (isTreeKey(key) ? !state.collapsed.has(key) : state.expanded.has(key));

/**
 * The user's expansion with `keys` opened or closed. Unchanged sets are
 * returned as they are, so identity comparison still detects change.
 * @param {ViewState} state
 * @param {readonly ContainerKey[]} keys
 * @param {boolean} open
 * @returns {Pick<ViewState, 'expanded' | 'collapsed'>}
 */
function withOpen(state, keys, open) {
  /** @type {Set<ContainerKey> | null} */ let expanded = null;
  /** @type {Set<ContainerKey> | null} */ let collapsed = null;
  for (const key of keys) {
    if (userOpen(state, key) === open) continue;
    if (isTreeKey(key)) {
      collapsed ??= new Set(state.collapsed);
      if (open) collapsed.delete(key); else collapsed.add(key);
    } else {
      expanded ??= new Set(state.expanded);
      if (open) expanded.add(key); else expanded.delete(key);
    }
  }
  return { expanded: expanded ?? state.expanded, collapsed: collapsed ?? state.collapsed };
}

/**
 * Displayed expansion of a container.
 * @param {ViewState} state
 * @param {Filter | null} filter
 * @returns {(key: ContainerKey) => boolean}
 */
export function isExpandedFn(state, filter) {
  return (key) => {
    const o = state.overrides.get(key);
    if (filter && o !== undefined) return o;
    return userOpen(state, key) || (filter?.expand.has(key) ?? false);
  };
}

/**
 * Flatten a file's tree into the rows currently visible ((tree >) region >
 * exam > program; steps are never tree rows). Only a file with several trees
 * has tree rows. A tree, region or exam is expandable when it has children.
 * @param {ExarFile} file
 * @param {(key: ContainerKey) => boolean} isExpanded
 * @param {Filter | null} filter
 * @param {Marks} [marks] keys marked as using customer sequences or having upgrade notes (the
 *   default is not seqmarks.js's NO_MARKS: seqmarks.js imports this module)
 * @returns {Row[]}
 */
export function buildRows(file, isExpanded, filter, marks = { custom: new Set(), upgrade: new Set() }) {
  /** @type {Row[]} */
  const rows = [];
  /** @param {ContainerKey} key */
  const shown = (key) => filter === null || filter.visible.has(key);
  /**
   * @param {{key:ContainerKey, label:string}} n @param {Row['kind']} kind @param {number} depth
   * @param {number} count @param {ContainerKey|null} parentKey @param {number} [problems]
   */
  const push = (n, kind, depth, count, parentKey, problems = 0) => {
    const expandable = kind !== 'program' && count > 0;
    rows.push({
      key: n.key, kind, level: /** @type {Row['level']} */ (depth), label: n.label, count, expandable, parentKey,
      expanded: expandable && isExpanded(n.key),
      match: filter?.matches.has(n.key) ?? false,
      hasMatch: filter?.expand.has(n.key) ?? false,
      hits: filter?.stepHits.get(n.key) ?? 0,
      problems,
      custom: marks.custom.has(n.key),
      upgrade: marks.upgrade.has(n.key),
    });
  };
  /** Regions per tree. @type {Map<ContainerKey, number>} */
  const treeSizes = new Map();
  for (const { tree } of file.regions) if (tree) treeSizes.set(tree.key, (treeSizes.get(tree.key) ?? 0) + 1);
  // A tree's regions are contiguous (tree.js descends depth-first), so its row goes before
  // the first of them and `open` holds for the rest.
  /** @type {ContainerKey | null} */ let treeKey = null;
  let open = true;
  for (const region of file.regions) {
    const { tree } = region;
    if ((tree?.key ?? null) !== treeKey) {
      treeKey = tree?.key ?? null;
      open = tree === null || shown(tree.key);
      if (tree && open) {
        push(tree, 'tree', 1, treeSizes.get(tree.key) ?? 0, null);
        open = isExpanded(tree.key);
      }
    }
    if (!open || !shown(region.key)) continue;
    const d = tree ? 1 : 0;
    push(region, 'region', 1 + d, region.exams.length, tree?.key ?? null);
    if (!isExpanded(region.key)) continue;
    for (const exam of region.exams) {
      if (!shown(exam.key)) continue;
      push(exam, 'exam', 2 + d, exam.programs.length, region.key);
      if (!isExpanded(exam.key)) continue;
      for (const program of exam.programs) {
        if (shown(program.key)) {
          push(program, 'program', 3 + d, displaySteps(program.body).length, exam.key, programProblems(program).length);
        }
      }
    }
  }
  return rows;
}

/**
 * Container ancestors of `key` (the file excluded), nearest first. Empty for unknown keys.
 * @param {Workspace} ws
 * @param {string} key
 * @returns {ContainerKey[]}
 */
export function ancestorKeys(ws, key) {
  const loc = lookup(ws, key);
  if (!loc) return [];
  const keys = loc.ancestors.flatMap((a) => ('label' in a ? [a.key] : [])).reverse();
  // The region's tree is not among the located ancestors; it is the farthest.
  const region = loc.level === 'region' ? loc.node : loc.level === 'file' || loc.level === 'tree' ? null : loc.ancestors[1];
  return region?.tree ? [...keys, region.tree.key] : keys;
}

/**
 * @param {Workspace} ws
 * @param {string} key
 * @param {ContainerKey} ancestor
 */
export function isDescendant(ws, key, ancestor) {
  return ancestorKeys(ws, key).includes(ancestor);
}

/**
 * True when `key` is a tree, region, exam or program of file `fileId`.
 * @param {Workspace} ws @param {string | null} fileId @param {string | null} key
 */
function isContainerOf(ws, fileId, key) {
  if (key === null) return false;
  const loc = lookup(ws, key);
  return loc !== undefined && loc.level !== 'file' && loc.level !== 'step' && loc.ancestors[0].id === fileId;
}

/** @param {string} key file id of a key (its prefix) */
const fileIdOf = (key) => key.slice(0, key.indexOf(':'));

/**
 * Make the state consistent with the workspace: a closed file falls back to
 * the first one (selection cleared, filter overrides dropped); a selection
 * that is not a tree, region, exam or program of the shown file is cleared
 * (files are read-only, so it can only vanish with its file); expansion and
 * collapsed trees of closed files are forgotten.
 * @param {Workspace} ws
 * @param {ViewState} state
 * @returns {ViewState}
 */
export function reconcile(ws, state) {
  let s = state;
  if (!fileById(ws, s.fileId)) {
    const fileId = ws.files[0]?.id ?? null;
    if (s.fileId !== fileId || s.selected !== null) s = { ...s, fileId, overrides: new Map(), selected: null };
  }
  if (s.selected !== null && !isContainerOf(ws, s.fileId, s.selected)) s = { ...s, selected: null };
  const open = new Set(ws.files.map((f) => f.id));
  if ([...s.expanded].some((k) => !open.has(fileIdOf(k)))) {
    s = { ...s, expanded: new Set([...s.expanded].filter((k) => open.has(fileIdOf(k)))) };
  }
  if ([...s.collapsed].some((k) => !open.has(fileIdOf(k)))) {
    s = { ...s, collapsed: new Set([...s.collapsed].filter((k) => open.has(fileIdOf(k)))) };
  }
  return s;
}

/**
 * The selection if it is a shown row, else its nearest shown ancestor, else
 * null. Keyboard navigation and aria-activedescendant start from here.
 * @param {Workspace} ws
 * @param {readonly Row[]} rows
 * @param {ContainerKey | null} selected
 * @returns {ContainerKey | null}
 */
export function anchorKey(ws, rows, selected) {
  if (selected === null) return null;
  const shown = new Set(rows.map((r) => r.key));
  if (shown.has(selected)) return selected;
  return ancestorKeys(ws, selected).find((k) => shown.has(k)) ?? null;
}

/**
 * Map a keydown `key` to an action, relative to the anchor row. Null means the
 * key is not a tree key; `{type:'none'}` means handled but nothing to do.
 * @param {string} key
 * @param {readonly Row[]} rows
 * @param {ContainerKey | null} anchor
 * @returns {Action | null}
 */
export function keyToAction(key, rows, anchor) {
  const i = rows.findIndex((r) => r.key === anchor);
  const row = rows[i];
  /** @param {Row | undefined} r @returns {Action} */
  const select = (r) => (r ? { type: 'select', key: r.key } : { type: 'none' });
  switch (key) {
    case 'ArrowDown': return select(i < 0 ? rows[0] : rows[i + 1]);
    case 'ArrowUp': return select(i < 0 ? rows[0] : rows[i - 1]);
    case 'Home': return select(rows[0]);
    case 'End': return select(rows[rows.length - 1]);
    case 'ArrowLeft':
      if (!row) return { type: 'none' };
      if (row.expanded) return { type: 'collapse', key: row.key };
      return row.parentKey ? { type: 'select', key: row.parentKey } : { type: 'none' };
    case 'ArrowRight':
      if (!row) return { type: 'none' };
      if (row.expandable && !row.expanded) return { type: 'expand', key: row.key };
      return row.expanded && rows[i + 1]?.parentKey === row.key ? select(rows[i + 1]) : { type: 'none' };
    case 'Enter':
    case ' ':
      return row?.expandable ? { type: 'toggle', key: row.key } : { type: 'none' };
    default: return null;
  }
}

/**
 * @param {Workspace} ws
 * @param {ViewState} state
 * @param {Filter | null} filter
 * @param {Action} action
 * @returns {ViewState}
 */
export function applyAction(ws, state, filter, action) {
  if (action.type === 'none') return state;
  if (action.type === 'select') return state.selected === action.key ? state : { ...state, selected: action.key };
  const was = isExpandedFn(state, filter)(action.key);
  const want = action.type === 'toggle' ? !was : action.type === 'expand';
  if (want === was) return state;
  /** @type {ViewState} */
  let next;
  if (filter) {
    next = { ...state, overrides: new Map(state.overrides).set(action.key, want) };
  } else {
    next = { ...state, ...withOpen(state, [action.key], want) };
  }
  // Collapsing an ancestor of the selection moves the selection onto it.
  if (!want && state.selected !== null && isDescendant(ws, state.selected, action.key)) {
    next = { ...next, selected: action.key };
  }
  return next;
}

/**
 * Switch file from the dropdown: selection cleared, filter overrides dropped.
 * @param {ViewState} state
 * @param {string} fileId
 * @returns {ViewState}
 */
export function selectFile(state, fileId) {
  return state.fileId === fileId ? state : { ...state, fileId, selected: null, overrides: new Map() };
}

/**
 * New query. Overrides are discarded; on leaving the filter the path to the
 * selection is opened in the user's expansion so the selection stays visible.
 * @param {Workspace} ws
 * @param {ViewState} state
 * @param {string} query
 * @returns {ViewState}
 */
export function setQuery(ws, state, query) {
  if (query === state.query) return state;
  const open = query === '' && state.selected !== null ? withOpen(state, ancestorKeys(ws, state.selected), true) : {};
  return { ...state, query, ...open, overrides: new Map() };
}

/**
 * Select a container, opening its ancestors in the user's expansion and
 * switching to its file. Unknown, file or step keys leave the state unchanged.
 * @param {Workspace} ws
 * @param {ViewState} state
 * @param {ContainerKey} key
 * @returns {ViewState}
 */
export function revealState(ws, state, key) {
  const loc = lookup(ws, key);
  if (!loc || loc.level === 'file' || loc.level === 'step') return state;
  return {
    ...state,
    fileId: loc.ancestors[0].id,
    ...withOpen(state, ancestorKeys(ws, key), true),
    overrides: new Map(),
    selected: key,
  };
}

/**
 * Navigate to a step: its file, tree, region, exam and program are revealed and the
 * search cleared so the program is visible. Unknown, file, region, exam and
 * program keys leave the state unchanged (the same object).
 * @param {Workspace} ws
 * @param {ViewState} state
 * @param {string} stepKey
 * @returns {ViewState}
 */
export function revealStepState(ws, state, stepKey) {
  const loc = lookup(ws, stepKey);
  if (loc?.level !== 'step') return state;
  return revealState(ws, setQuery(ws, state, ''), loc.ancestors[3].key);
}

/**
 * Split a label into runs so leading/trailing whitespace and internal runs of
 * 2+ whitespace characters can be styled. Concatenating `text` gives the label.
 * @param {string} label
 * @returns {{text:string, ws:boolean}[]}
 */
export function splitWhitespace(label) {
  return label.split(/(^\s+|\s+$|\s{2,})/).flatMap((text, i) => (text === '' ? [] : [{ text, ws: i % 2 === 1 }]));
}

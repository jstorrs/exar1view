// @ts-check
/**
 * What the panes show selected, for features that act on it (comparing two
 * measurement steps or two programs): whether split view is on, each pane's
 * selected step keys in list order and each pane's selected program key. The
 * second pane's selection counts only while split view is on. main.js writes
 * it; readers subscribe.
 */

/**
 * @typedef {{
 *   split: boolean,
 *   steps: readonly [readonly string[], readonly string[]],
 *   programs: readonly [string | null, string | null],
 * }} SelectionState
 */

/**
 * Selected step keys of the shown panes, left pane first; a step selected in
 * both panes counts once.
 * @param {SelectionState} s
 * @returns {string[]}
 */
export const shownSelection = (s) => [...new Set(s.split ? [...s.steps[0], ...s.steps[1]] : s.steps[0])];

/**
 * The selected program keys of the two panes, left first, while split view is on; a pane
 * without a program selected gives none. Otherwise empty.
 * @param {SelectionState} s
 * @returns {string[]}
 */
export const shownPrograms = ({ split, programs: [left, right] }) => (split && left !== null && right !== null ? [left, right] : []);

export function createSelectionStore() {
  /** @type {SelectionState} */
  let state = { split: false, steps: [[], []], programs: [null, null] };
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @param {SelectionState} next */
  const set = (next) => {
    state = next;
    for (const fn of listeners) fn();
  };
  return {
    get: () => state,
    /** @param {0 | 1} pane @param {readonly string[]} keys */
    setSteps(pane, keys) {
      const old = state.steps[pane];
      if (old.length === keys.length && old.every((k, i) => k === keys[i])) return;
      set({ ...state, steps: pane === 0 ? [keys, state.steps[1]] : [state.steps[0], keys] });
    },
    /** @param {0 | 1} pane @param {string | null} key */
    setProgram(pane, key) {
      if (state.programs[pane] === key) return;
      set({ ...state, programs: pane === 0 ? [key, state.programs[1]] : [state.programs[0], key] });
    },
    /** @param {boolean} split */
    setSplit(split) {
      if (split !== state.split) set({ ...state, split });
    },
    /** @param {() => void} fn @returns {() => void} unsubscribe */
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

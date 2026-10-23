// @ts-check
/**
 * Pure multi-selection for a list of keyed items (the right-hand list):
 * click / Ctrl-click / Shift-click, arrow keys with optional Shift range,
 * select all, and reconciliation when the items change. Selections are
 * immutable; a function returns the same object when nothing changes.
 *
 * `anchor` is where a Shift range starts; `focus` is the active item (the
 * one keyboard navigation moves from and aria-activedescendant points at).
 */

/** @typedef {string} NodeKey */
/** @typedef {{selected: ReadonlySet<NodeKey>, anchor: NodeKey|null, focus: NodeKey|null}} ListSelection */
/** @typedef {'next'|'prev'|'first'|'last'} Move */

/** @type {ListSelection} */
export const EMPTY_SELECTION = Object.freeze({ selected: new Set(), anchor: null, focus: null });

/**
 * Selection of exactly `keys` (those present in `items`), anchored at the
 * first and focused on the last.
 * @param {readonly NodeKey[]} items
 * @param {readonly NodeKey[]} keys
 * @returns {ListSelection}
 */
export function selectKeys(items, keys) {
  const present = keys.filter((k) => items.includes(k));
  if (present.length === 0) return EMPTY_SELECTION;
  return { selected: new Set(present), anchor: present[0], focus: present[present.length - 1] };
}

/** @param {readonly NodeKey[]} items @param {NodeKey} a @param {NodeKey} b */
function range(items, a, b) {
  const i = items.indexOf(a);
  const j = items.indexOf(b);
  return i < 0 || j < 0 ? [b] : items.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/**
 * Pointer click on `key`. `toggle` (Ctrl/Cmd) flips it; `extend` (Shift)
 * selects from the anchor to it, added to the selection when also toggling.
 * @param {readonly NodeKey[]} items
 * @param {ListSelection} sel
 * @param {NodeKey} key
 * @param {{toggle?:boolean, extend?:boolean}} [mods]
 * @returns {ListSelection}
 */
export function clickSelect(items, sel, key, { toggle = false, extend = false } = {}) {
  if (!items.includes(key)) return sel;
  if (extend) {
    const span = range(items, sel.anchor ?? key, key);
    const selected = new Set(toggle ? [...sel.selected, ...span] : span);
    return { selected, anchor: sel.anchor ?? key, focus: key };
  }
  if (toggle) {
    const selected = new Set(sel.selected);
    if (selected.has(key)) selected.delete(key); else selected.add(key);
    return { selected, anchor: key, focus: key };
  }
  return { selected: new Set([key]), anchor: key, focus: key };
}

/**
 * Keyboard move of the focus. Without `extend` the focus item alone is
 * selected; with it the range from the anchor to the new focus is.
 * @param {readonly NodeKey[]} items
 * @param {ListSelection} sel
 * @param {Move} move
 * @param {{extend?:boolean}} [mods]
 * @returns {ListSelection}
 */
export function moveSelect(items, sel, move, { extend = false } = {}) {
  if (items.length === 0) return sel;
  const i = sel.focus === null ? -1 : items.indexOf(sel.focus);
  const j = move === 'first' ? 0 : move === 'last' ? items.length - 1
    : i < 0 ? 0 : Math.max(0, Math.min(items.length - 1, i + (move === 'next' ? 1 : -1)));
  const key = items[j];
  if (extend) {
    const anchor = sel.anchor ?? key;
    return { selected: new Set(range(items, anchor, key)), anchor, focus: key };
  }
  if (sel.focus === key && sel.selected.size === 1 && sel.selected.has(key)) return sel;
  return { selected: new Set([key]), anchor: key, focus: key };
}

/**
 * Ctrl+Space: toggle the focus item.
 * @param {readonly NodeKey[]} items
 * @param {ListSelection} sel
 * @returns {ListSelection}
 */
export function toggleFocus(items, sel) {
  return sel.focus === null ? sel : clickSelect(items, sel, sel.focus, { toggle: true });
}

/**
 * @param {readonly NodeKey[]} items
 * @param {ListSelection} sel
 * @returns {ListSelection}
 */
export function selectAll(items, sel) {
  if (items.length === 0) return sel;
  return { selected: new Set(items), anchor: sel.anchor ?? items[0], focus: sel.focus ?? items[0] };
}

/**
 * Bring a selection up to date with new items. Vanished keys drop out; if the
 * focus vanished it moves to the nearest surviving item that followed it in
 * `prevItems` (else preceded it), and if nothing selected survived that item
 * becomes the selection, so the user keeps their place after a delete or cut.
 * @param {readonly NodeKey[]} prevItems
 * @param {readonly NodeKey[]} items
 * @param {ListSelection} sel
 * @returns {ListSelection}
 */
export function reconcileSelection(prevItems, items, sel) {
  const present = new Set(items);
  const keep = [...sel.selected].filter((k) => present.has(k));
  const focusOk = sel.focus === null || present.has(sel.focus);
  const anchorOk = sel.anchor === null || present.has(sel.anchor);
  if (keep.length === sel.selected.size && focusOk && anchorOk) return sel;
  let focus = focusOk ? sel.focus : null;
  if (!focusOk) {
    const i = prevItems.indexOf(/** @type {NodeKey} */ (sel.focus));
    const after = i < 0 ? [] : prevItems.slice(i + 1);
    const before = i < 0 ? [] : prevItems.slice(0, i).reverse();
    focus = [...after, ...before].find((k) => present.has(k)) ?? null;
  }
  const selected = new Set(keep.length || focus === null ? keep : [focus]);
  return { selected, anchor: anchorOk ? sel.anchor : focus, focus };
}

/**
 * Selected keys in list order.
 * @param {readonly NodeKey[]} items
 * @param {ListSelection} sel
 * @returns {NodeKey[]}
 */
export function selectedInOrder(items, sel) {
  return items.filter((k) => sel.selected.has(k));
}

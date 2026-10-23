// @ts-check
/**
 * Popup (context) menu. role="menu" with roving focus over its role="menuitem"
 * buttons: arrows / Home / End move, Enter or Space run, Escape or Tab close.
 * Closes on outside pointer down or when focus leaves it. One menu at a time.
 */
import { h } from './dom.js';

/**
 * @typedef {{label:string, run:() => void}} MenuItem
 * @typedef {MenuItem | 'separator'} MenuEntry
 */

/** @type {(() => void) | null} */
let closeCurrent = null;

/** Close the open menu, if any, without restoring focus. */
export function closeMenu() { closeCurrent?.(); }

/**
 * Open a menu at viewport coordinates.
 * @param {{x:number, y:number}} at
 * @param {readonly MenuEntry[]} entries
 * @param {{label:string, returnFocus?:HTMLElement|null, onClose?:() => void}} opts
 */
export function openMenu(at, entries, { label, returnFocus = null, onClose }) {
  closeMenu();
  /** @type {HTMLButtonElement[]} */
  const buttons = [];
  const el = h('div', { class: 'menu', role: 'menu', 'aria-label': label, tabindex: -1 },
    entries.map((e) => {
      if (e === 'separator') return h('div', { class: 'menu-sep', role: 'separator' });
      const b = /** @type {HTMLButtonElement} */ (h('button', {
        type: 'button', class: 'menu-item', role: 'menuitem', tabindex: -1,
        onClick: () => activate(e),
      }, h('span', { class: 'menu-label' }, e.label)));
      buttons.push(b);
      return b;
    }));

  let open = true;
  /** @param {boolean} restore */
  const close = (restore) => {
    if (!open) return;
    open = false;
    closeCurrent = null;
    document.removeEventListener('pointerdown', onOutside, true);
    el.remove();
    if (restore) returnFocus?.focus();
    onClose?.();
  };
  /** @param {MenuItem} e */
  function activate(e) {
    close(true);
    e.run();
  }
  /** @param {PointerEvent} ev */
  function onOutside(ev) {
    if (!el.contains(/** @type {Node} */ (ev.target))) close(false);
  }
  /** @param {number} i */
  const focusAt = (i) => buttons[(i + buttons.length) % buttons.length]?.focus();
  el.addEventListener('keydown', (ev) => {
    const i = buttons.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    switch (ev.key) {
      case 'ArrowDown': focusAt(i + 1); break;
      case 'ArrowUp': focusAt(i < 0 ? -1 : i - 1); break;
      case 'Home': focusAt(0); break;
      case 'End': focusAt(-1); break;
      case 'Escape': close(true); break;
      case 'Tab': close(true); break;
      case 'Enter': case ' ': {
        const b = /** @type {HTMLElement} */ (ev.target).closest('.menu-item');
        if (b) b.dispatchEvent(new MouseEvent('click'));
        break;
      }
      default: return;
    }
    ev.preventDefault();
    ev.stopPropagation();
  });
  el.addEventListener('focusout', (ev) => {
    if (!el.contains(/** @type {Node | null} */ (ev.relatedTarget))) close(false);
  });
  el.addEventListener('contextmenu', (ev) => ev.preventDefault());

  document.body.append(el);
  const { innerWidth: vw, innerHeight: vh } = window;
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(0, Math.min(at.x, vw - r.width - 4))}px`;
  el.style.top = `${Math.max(0, at.y + r.height > vh ? at.y - r.height : at.y)}px`;
  document.addEventListener('pointerdown', onOutside, true);
  closeCurrent = () => close(false);
  (buttons[0] ?? el).focus();
}

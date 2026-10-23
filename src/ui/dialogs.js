// @ts-check
/**
 * Modal dialogs on the native <dialog> element: the browser traps focus
 * while it is open and Escape closes it. Focus returns to whatever had it
 * before.
 */
import { h } from './dom.js';
import { visibleText } from '../core/visible.js';

let dialogCounter = 0;

/**
 * Show a list of problems (level, where, message) with a Close button.
 * Text is shown with its control characters made visible.
 * @param {{title:string, problems:readonly import('../core/model.js').Problem[]}} opts
 * @returns {Promise<void>} when closed
 */
export function problemsDialog({ title, problems }) {
  const id = `dlg${++dialogCounter}`;
  const returnFocus = /** @type {HTMLElement | null} */ (document.activeElement);
  const close = h('button', { type: 'submit', class: 'btn', value: 'close' }, 'Close');
  const dlg = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'dialog dialog-wide', 'aria-labelledby': `${id}-t` },
    h('form', { method: 'dialog' },
      h('h2', { id: `${id}-t`, class: 'dialog-title' }, title),
      h('div', { class: 'problems-wrap', tabindex: 0, role: 'region', 'aria-label': 'Problems' },
        h('table', { class: 'problems' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Level'), h('th', { scope: 'col' }, 'Where'),
            h('th', { scope: 'col' }, 'Message'))),
          h('tbody', null, problems.map((p) => h('tr', { class: `problem-${p.level}` },
            h('td', { class: 'problem-level' }, p.level === 'error' ? 'Error' : 'Warning'),
            h('td', null, visibleText(p.where)),
            h('td', null, visibleText(p.message))))))),
      h('div', { class: 'dialog-buttons' }, close))));
  document.body.append(dlg);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (returnFocus?.isConnected) returnFocus.focus();
      resolve();
    }, { once: true });
    dlg.showModal();
    close.focus();
  });
}

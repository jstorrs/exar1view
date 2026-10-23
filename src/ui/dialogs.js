// @ts-check
/**
 * Modal dialogs on the native <dialog> element: the browser traps focus
 * while it is open and Escape cancels. In the confirm dialog Cancel has the
 * initial focus, so Enter does not confirm by accident; in the prompt the
 * input does. Focus returns to whatever had it before.
 */
import { h } from './dom.js';

let dialogCounter = 0;

/**
 * @param {{title:string, lines:readonly string[], confirmLabel:string}} opts
 * @returns {Promise<boolean>} true when confirmed
 */
export function confirmDialog({ title, lines, confirmLabel }) {
  const id = `dlg${++dialogCounter}`;
  const returnFocus = /** @type {HTMLElement | null} */ (document.activeElement);
  const cancel = h('button', { type: 'submit', class: 'btn', value: 'cancel' }, 'Cancel');
  const dlg = /** @type {HTMLDialogElement} */ (h('dialog', {
    class: 'dialog', 'aria-labelledby': `${id}-t`, 'aria-describedby': `${id}-d`,
  },
    h('form', { method: 'dialog' },
      h('h2', { id: `${id}-t`, class: 'dialog-title' }, title),
      h('div', { id: `${id}-d` }, lines.map((line) => h('p', null, line))),
      h('div', { class: 'dialog-buttons' },
        cancel,
        h('button', { type: 'submit', class: 'btn danger', value: 'confirm' }, confirmLabel)))));
  document.body.append(dlg);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const confirmed = dlg.returnValue === 'confirm';
      dlg.remove();
      if (returnFocus?.isConnected) returnFocus.focus();
      resolve(confirmed);
    }, { once: true });
    dlg.showModal();
    cancel.focus();
  });
}

/**
 * Ask for a line of text. `prefix` is shown fixed before the input and is not
 * part of the value. `check` runs on every input: an error blocks submit, a
 * warning does not. The value is never trimmed.
 * @param {{
 *   title: string, label: string, prefix: string, initial: string, confirmLabel: string,
 *   check: (value: string) => {error: string | null, warning: string | null},
 * }} opts
 * @returns {Promise<string | null>} the text, or null when cancelled
 */
export function promptDialog({ title, label, prefix, initial, confirmLabel, check }) {
  const id = `dlg${++dialogCounter}`;
  const returnFocus = /** @type {HTMLElement | null} */ (document.activeElement);
  const input = /** @type {HTMLInputElement} */ (h('input', {
    type: 'text', id: `${id}-i`, class: 'rename-input', value: initial, spellcheck: false,
    autocomplete: 'off', 'aria-describedby': `${id}-msg`,
  }));
  const msg = h('p', { id: `${id}-msg`, class: 'rename-msg' });
  const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
  const ok = /** @type {HTMLButtonElement} */ (h('button', { type: 'submit', class: 'btn', value: 'confirm' }, confirmLabel));
  const form = h('form', { method: 'dialog' },
    h('h2', { id: `${id}-t`, class: 'dialog-title' }, title),
    h('label', { for: `${id}-i` }, `${label} (${prefix} is added in front)`),
    h('div', { class: 'prompt-field' }, h('span', { class: 'prompt-prefix', 'aria-hidden': 'true' }, prefix), input),
    msg,
    h('div', { class: 'dialog-buttons' }, cancel, ok));
  const dlg = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'dialog', 'aria-labelledby': `${id}-t` }, form));

  let invalid = false;
  const validate = () => {
    const { error, warning } = check(input.value);
    invalid = error !== null;
    msg.textContent = error ?? warning ?? '';
    msg.className = `rename-msg ${error ? 'error' : warning ? 'warn' : ''}`;
    if (error) msg.setAttribute('role', 'alert'); else msg.removeAttribute('role');
    input.setAttribute('aria-invalid', String(invalid));
    ok.disabled = invalid;
  };
  input.addEventListener('input', validate);
  form.addEventListener('submit', (e) => { if (invalid) e.preventDefault(); });
  cancel.addEventListener('click', () => dlg.close('cancel'));
  validate();
  document.body.append(dlg);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const value = dlg.returnValue === 'confirm' ? input.value : null;
      dlg.remove();
      if (returnFocus?.isConnected) returnFocus.focus();
      resolve(value);
    }, { once: true });
    dlg.showModal();
    input.focus();
    input.select();
  });
}

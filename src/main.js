// @ts-check
/**
 * Bootstrap (imperative shell): wires the Open button to the file input.
 * For now it only reports the chosen file names; loading comes later.
 */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const statusEl = $('status');
const fileInput = /** @type {HTMLInputElement} */ ($('file-input'));

$('open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const names = Array.from(fileInput.files ?? [], (f) => f.name);
  statusEl.textContent = names.length ? `Chosen: ${names.join(', ')}` : '';
  fileInput.value = '';
});

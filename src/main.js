// @ts-check
/**
 * Bootstrap (imperative shell): wires the Open button to the file input.
 * For now it only reports the chosen file names; loading comes later.
 */

import { loadSqlJs } from './platform/sqlite.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const statusEl = $('status');
const errorsEl = $('errors');
const fileInput = /** @type {HTMLInputElement} */ ($('file-input'));

$('open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const names = Array.from(fileInput.files ?? [], (f) => f.name);
  statusEl.textContent = names.length ? `Chosen: ${names.join(', ')}` : '';
  fileInput.value = '';
});

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
  (/** @type {unknown} */ err) => {
    errorsEl.textContent = err instanceof Error ? err.message : String(err);
    errorsEl.hidden = false;
  },
);

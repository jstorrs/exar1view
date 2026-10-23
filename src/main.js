// @ts-check
/**
 * Bootstrap (imperative shell). TEMPORARY probe UI: opens each chosen or
 * dropped file and reports table row counts and how long inflating the
 * structural documents takes. Step 8 replaces this with the real viewer.
 */

import { loadSqlJs, openDb } from './platform/sqlite.js';
import { inflateRaw } from './platform/inflate.js';
import { loadExar } from './core/load.js';
import { installFileDrop } from './ui/filedrop.js';
import { h } from './ui/dom.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const statusEl = $('status');
const errorsEl = $('errors');
const appEl = $('app');
const fileInput = /** @type {HTMLInputElement} */ ($('file-input'));

/** @param {string} message */
function showError(message) {
  errorsEl.append(h('div', null, message));
  errorsEl.hidden = false;
}

/** @param {unknown} err */
const errorText = (err) => (err instanceof Error ? err.message : String(err));

const ms = (/** @type {number} */ t) => `${t.toFixed(0)} ms`;
const mb = (/** @type {number} */ n) => `${(n / 1048576).toFixed(2)} MB`;

/** Structural documents: everything except the big, lazily loaded ones. */
const STRUCTURAL_DOCS_SQL = `select distinct c.Hash, c.Data from Content c
  join Instance i on i.ContentHash = c.Hash
  where i.InstanceType not in ('EdfProtocol', 'EdfAddInConfig')`;

/**
 * @param {import('./platform/sqlite.js').SqlJs} SQL
 * @param {File} file
 * @returns {Promise<HTMLElement>}
 */
async function probeFile(SQL, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const t0 = performance.now();
  const { db, wal, close } = openDb(SQL, bytes);
  const openMs = performance.now() - t0;
  try {
    const tables = db.rows("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
      .map(([name]) => String(name));
    const counts = tables.map((name) => {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      return /** @type {const} */ ([name, Number(db.rows(`select count(*) from ${quoted}`)[0][0])]);
    });

    let compressed = 0;
    let inflated = 0;
    let docs = 0;
    const t1 = performance.now();
    const docRows = db.rows(STRUCTURAL_DOCS_SQL);
    const queryMs = performance.now() - t1;
    const t2 = performance.now();
    for (const [, data] of docRows) {
      if (!(data instanceof Uint8Array)) continue;
      compressed += data.length;
      inflated += (await inflateRaw(data)).length;
      docs++;
    }
    const inflateMs = performance.now() - t2;

    const t3 = performance.now();
    const loadedFile = await loadExar(db, inflateRaw, { id: 'f1', name: file.name, size: file.size },
      (p) => { statusEl.textContent = `Loading ${file.name}: ${p.phase} ${p.done}/${p.total}`; });
    const loadMs = performance.now() - t3;
    const treeRows = loadedFile.ok
      ? [
        ['Regions / exams / programs', [
          loadedFile.file.regions.length,
          loadedFile.file.regions.reduce((n, r) => n + r.exams.length, 0),
          loadedFile.file.regions.reduce((n, r) => n + r.exams.reduce((m, e) => m + e.programs.length, 0), 0),
        ].join(' / ')],
        ['Problems (file / program)', [
          loadedFile.file.problems.length,
          loadedFile.file.regions.reduce((n, r) => n + r.exams.reduce((m, e) => m + e.programs.reduce((k, p) => k + p.problems.length, 0), 0), 0),
        ].join(' / ')],
        ['Load model', ms(loadMs)],
      ]
      : [['Load failed', loadedFile.error]];

    return h('section', { class: 'probe-file' },
      h('h2', null, file.name),
      h('dl', null,
        ...[
          ['Size', mb(file.size)],
          ['Open', ms(openMs)],
          ['WAL patched', wal ? 'yes' : 'no'],
          ['Structural docs', String(docs)],
          ['Compressed', mb(compressed)],
          ['Inflated', mb(inflated)],
          ['Fetch docs (query)', ms(queryMs)],
          ['Inflate all (sequential)', ms(inflateMs)],
          ...treeRows,
        ].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Table'), h('th', null, 'Rows'))),
        h('tbody', null, counts.map(([name, n]) => h('tr', null, h('td', null, name), h('td', null, n))))));
  } finally {
    close();
  }
}

let probeHost = /** @type {HTMLElement | undefined} */ (undefined);

/** @param {File[]} files */
async function probeFiles(files) {
  if (!files.length) return;
  let SQL;
  try {
    SQL = await loadSqlJs();
  } catch (err) {
    showError(errorText(err));
    return;
  }
  if (!probeHost) {
    probeHost = h('div', { class: 'probe' }, h('p', { class: 'probe-ua' }, `Browser: ${navigator.userAgent}`));
    appEl.replaceChildren(probeHost);
  }
  for (const file of files) {
    statusEl.textContent = `Probing ${file.name}…`;
    try {
      probeHost.append(await probeFile(SQL, file));
    } catch (err) {
      showError(`${file.name}: ${errorText(err)}`);
    }
  }
  statusEl.textContent = '';
}

$('open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files ?? [])];
  fileInput.value = '';
  void probeFiles(files);
});
installFileDrop((files) => void probeFiles(files));

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
  (/** @type {unknown} */ err) => showError(errorText(err)),
);

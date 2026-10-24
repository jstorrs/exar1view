// @ts-check
/**
 * SQLite access. `loadSqlJs` (browser: DOM + fetch) is kept apart from
 * `openDb`/`Db`, which only need an sql.js `SQL` object and so also run in Node.
 */

/**
 * The parts of sql.js used here; no @types package.
 * @typedef {{
 *   bind(params?: readonly (string | number | null)[]): boolean,
 *   step(): boolean,
 *   get(): unknown[],
 *   free(): boolean,
 * }} SqlJsStatement
 * @typedef {{
 *   prepare(sql: string): SqlJsStatement,
 *   exec(sql: string): { columns: string[], values: unknown[][] }[],
 *   close(): void,
 * }} SqlJsDatabase
 * @typedef {{ Database: new (data?: Uint8Array) => SqlJsDatabase }} SqlJs
 */

/**
 * The read port later reader code uses.
 * @typedef {{ rows(sql: string, params?: readonly (string | number | null)[]): unknown[][] }} Db
 */

/** @type {Promise<SqlJs> | undefined} */
let sqlJsPromise;

/**
 * Load sql.js once. Needs the classic script `vendor/sql.js/sql-wasm.js` to
 * have defined `globalThis.initSqlJs`. The WASM bytes come from the inlined
 * `#sqljs-wasm` element (single-file build) or are fetched next to the page.
 * @returns {Promise<SqlJs>}
 */
export function loadSqlJs() {
  sqlJsPromise ??= fetchWasmBytes().then((wasmBinary) => {
    const init = /** @type {((cfg: { wasmBinary: Uint8Array }) => Promise<SqlJs>) | undefined} */ (
      /** @type {any} */ (globalThis).initSqlJs
    );
    if (!init) throw new Error('SQLite engine script (sql-wasm.js) did not load');
    return init({ wasmBinary });
  });
  // A failed load must not be cached forever.
  sqlJsPromise.catch(() => { sqlJsPromise = undefined; });
  return sqlJsPromise;
}

/** @returns {Promise<Uint8Array>} */
async function fetchWasmBytes() {
  const inline = document.getElementById('sqljs-wasm');
  if (inline) {
    const bin = atob((inline.textContent ?? '').trim());
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  const url = new URL('vendor/sql.js/sql-wasm.wasm', document.baseURI);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load SQLite engine (${res.status} ${res.statusText})`);
  return new Uint8Array(await res.arrayBuffer());
}

const MAGIC = 'SQLite format 3\0';

/**
 * Keep this at module level, not inside `openDb`: a closure created in
 * `openDb` that mentions `bytes` puts it in the context shared with the
 * returned `rows`/`close` closures, keeping the caller's whole input buffer
 * alive for as long as the database is open.
 * @param {Uint8Array} bytes
 */
function hasSqliteMagic(bytes) {
  return bytes.length >= 100 && Array.from(MAGIC, (c, i) => bytes[i] === c.charCodeAt(0)).every(Boolean);
}

/**
 * Open `bytes` as a read-only-in-spirit database. The input is not modified.
 * @param {SqlJs} SQL
 * @param {Uint8Array} bytes
 * @returns {{ db: Db, wal: boolean, close(): void }}
 */
export function openDb(SQL, bytes) {
  if (!hasSqliteMagic(bytes)) throw new Error('Not a SQLite file (missing "SQLite format 3" header)');

  // Header bytes 18/19 are the file-format write/read versions; 2 means WAL.
  // sql.js has no -wal file, so present the file as a rollback-journal one.
  const wal = bytes[18] === 2 && bytes[19] === 2;
  const copy = bytes.slice();
  if (wal) {
    copy[18] = 1;
    copy[19] = 1;
  }

  const handle = new SQL.Database(copy);
  /** @type {Db} */
  const db = {
    rows(sql, params = []) {
      const stmt = handle.prepare(sql);
      try {
        stmt.bind(params);
        const out = [];
        while (stmt.step()) out.push(stmt.get());
        return out;
      } finally {
        stmt.free();
      }
    },
  };
  return { db, wal, close: () => handle.close() };
}

// Node loader for the vendored sql.js (memoised).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const wasmPath = new URL('../vendor/sql.js/sql-wasm.wasm', import.meta.url);

/** @type {Promise<any> | undefined} */
let sqlPromise;

export function loadSql() {
  sqlPromise ??= require('../vendor/sql.js/sql-wasm.js')({ wasmBinary: readFileSync(wasmPath) });
  return sqlPromise;
}

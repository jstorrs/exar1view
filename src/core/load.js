// @ts-check
/**
 * Load one exar1 into the model: resolve the head, inflate and decode the structural
 * documents, build the tree. The Db port and the inflater are injected, so this runs
 * in Node as well as in the browser. Never throws: failures come back as `{ ok: false }`.
 */
import { INSTANCE_TYPES, decodeBytes } from './edf.js';
import { FormatError } from './errors.js';
import { checkSchema, loadHead } from './head.js';
import { buildRegions } from './tree.js';

/** @typedef {import('../platform/sqlite.js').Db} Db */
/** @typedef {import('./model.js').ExarFile} ExarFile */
/** @typedef {import('./docs.js').DocResult} DocResult */
/** @typedef {import('./head.js').InstanceRow} InstanceRow */

/** Documents decoded up front; protocols and add-in configs are big and loaded on demand. */
const STRUCTURAL_TYPES = new Set(
  /** @type {readonly string[]} */ (INSTANCE_TYPES).filter((t) => t !== 'EdfProtocol' && t !== 'EdfAddInConfig'));

/** @typedef {{ phase: 'head' | 'docs', done: number, total: number }} Progress */

/** Let the event loop run (paint, input) between slices of work. */
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve));

const CHUNK = 200;

/** @param {unknown} err */
const errorText = (err) => (err instanceof Error ? err.message : String(err));

/**
 * Inflate and decode one Content.Data value.
 * A directory document holds its password: only `IsProtected` is carried on.
 * @param {unknown} data
 * @param {(bytes: Uint8Array) => Promise<Uint8Array>} inflateRaw
 * @returns {Promise<DocResult>}
 */
async function decodeContent(data, inflateRaw) {
  if (!(data instanceof Uint8Array)) return { ok: false, message: 'content data is not a blob' };
  try {
    const { type, body } = decodeBytes(await inflateRaw(data));
    if (type === 'EdfDirectoryContent') return { ok: true, type, body: { IsProtected: body.IsProtected ?? null } };
    return { ok: true, type, body };
  } catch (err) {
    return { ok: false, message: errorText(err) };
  }
}

/**
 * Decode the documents of `rows` (each distinct hash once). A hash without a Content row
 * stays out of the result, which `docBody` reports as missing.
 * @param {Db} db
 * @param {Iterable<InstanceRow>} rows
 * @param {(bytes: Uint8Array) => Promise<Uint8Array>} inflateRaw
 * @param {((p: Progress) => void) | undefined} onProgress
 * @returns {Promise<Map<string, DocResult>>}
 */
async function decodeDocs(db, rows, inflateRaw, onProgress) {
  const hashes = [...new Set([...rows].filter((r) => STRUCTURAL_TYPES.has(r.type)).map((r) => r.contentHash))];
  /** @type {Map<string, DocResult>} */
  const docs = new Map();
  let done = 0;
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const chunk = hashes.slice(i, i + CHUNK);
    const marks = chunk.map(() => '?').join(',');
    for (const [hash, data] of db.rows(`select Hash, Data from Content where Hash in (${marks})`, chunk)) {
      docs.set(/** @type {string} */ (hash), await decodeContent(data, inflateRaw));
    }
    done += chunk.length;
    onProgress?.({ phase: 'docs', done, total: hashes.length });
    await yieldToEventLoop();
  }
  return docs;
}

/**
 * @param {Db} db
 * @param {(bytes: Uint8Array) => Promise<Uint8Array>} inflateRaw
 * @param {{ id: string, name: string, size: number }} meta
 * @param {(p: Progress) => void} [onProgress]
 * @returns {Promise<{ ok: true, file: ExarFile } | { ok: false, error: string }>}
 */
export async function loadExar(db, inflateRaw, meta, onProgress) {
  try {
    onProgress?.({ phase: 'head', done: 0, total: 1 });
    await yieldToEventLoop();
    const schemaProblems = checkSchema(db);
    const head = loadHead(db);
    onProgress?.({ phase: 'head', done: 1, total: 1 });
    await yieldToEventLoop();
    const docs = await decodeDocs(db, head.instances.values(), inflateRaw, onProgress);
    const { regions, problems } = buildRegions({ fileId: meta.id, instances: head.instances, docs });
    return {
      ok: true,
      file: {
        id: meta.id,
        name: meta.name,
        size: meta.size,
        baseline: head.baseline,
        changeset: head.changeset,
        regions,
        problems: [...schemaProblems, ...head.problems, ...problems],
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof FormatError ? err.message : `unexpected error: ${errorText(err)}` };
  }
}

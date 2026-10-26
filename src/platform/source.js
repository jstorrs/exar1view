// @ts-check
/**
 * Protocols of one open file, read on demand: a loaded file keeps its database open (in memory,
 * about the file's size) so that a protocol can be inflated, decoded and its ASCCONV parsed
 * when a comparison asks for it. Parsed protocols are cached, the most recently used kept.
 * `text` gives the raw protocol text instead (for scans over every protocol): it is not cached,
 * since a scan reads each protocol once and keeps only what it extracts.
 * Never throws: failures come back as `{ ok: false }` with a message that quotes no document text.
 */
import { decodeBytes } from '../core/edf.js';
import { errorText } from '../core/errors.js';
import { parseAscconv } from '../core/ascconv.js';

/** @typedef {import('./sqlite.js').Db} Db */
/** @typedef {import('../core/ascconv.js').Block} Block */
/** @typedef {{ ok: true, blocks: Block[], warnings: string[] } | { ok: false, error: string }} Protocol */
/** @typedef {{ ok: true, text: string } | { ok: false, error: string }} ProtocolText */

/**
 * @typedef {object} FileSource
 * @property {(blob: string) => Promise<Protocol>} protocol the parsed protocol whose Content hash is `blob`
 * @property {(blob: string) => Promise<ProtocolText>} text the raw text of the protocol whose Content hash is `blob`, uncached
 * @property {() => void} close release the database; later requests fail
 */

/**
 * @param {{ db: Db, close(): void }} opened from openDb
 * @param {(bytes: Uint8Array) => Promise<Uint8Array>} inflateRaw
 * @param {number} [capacity] parsed protocols kept
 * @returns {FileSource}
 */
export function createFileSource({ db, close }, inflateRaw, capacity = 50) {
  let open = true;
  /** Least recently used first; promises, so concurrent requests share one read. @type {Map<string, Promise<Protocol>>} */
  const cache = new Map();

  /** @param {string} blob @returns {Promise<ProtocolText>} */
  async function readText(blob) {
    try {
      const rows = db.rows('select Data from Content where Hash = ?', [blob]);
      if (rows.length === 0) return { ok: false, error: 'protocol content is missing' };
      const data = rows[0][0];
      if (!(data instanceof Uint8Array)) return { ok: false, error: 'protocol content is not a blob' };
      const { type, body } = decodeBytes(await inflateRaw(data));
      if (type !== 'EdfProtocolContent') return { ok: false, error: `expected a protocol, found ${type}` };
      if (typeof body.Data !== 'string') return { ok: false, error: 'protocol Data is not text' };
      return { ok: true, text: body.Data };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  }

  /** @param {string} blob @returns {Promise<Protocol>} */
  async function read(blob) {
    const t = await readText(blob);
    if (!t.ok) return t;
    const parsed = parseAscconv(t.text);
    return parsed.ok ? parsed : { ok: false, error: `protocol: ${parsed.error}` };
  }

  return {
    protocol(blob) {
      if (!open) return Promise.resolve({ ok: false, error: 'the file is closed' });
      let p = cache.get(blob);
      if (p) {
        cache.delete(blob);
      } else {
        p = read(blob);
        if (cache.size >= capacity) cache.delete(/** @type {string} */ (cache.keys().next().value));
      }
      cache.set(blob, p);
      return p;
    },
    text(blob) {
      return open ? readText(blob) : Promise.resolve({ ok: false, error: 'the file is closed' });
    },
    close() {
      if (!open) return;
      open = false;
      cache.clear();
      close();
    },
  };
}

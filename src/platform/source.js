// @ts-check
/**
 * Protocols of one open file, read on demand: a loaded file keeps its database open (in memory,
 * about the file's size) so that a protocol can be inflated, decoded and its ASCCONV parsed
 * when a comparison asks for it. Parsed protocols are cached, the most recently used kept.
 * `text` gives the raw protocol text instead (for scans over every protocol, and the protocol
 * panel's XProtocol tab): it is not cached, since a scan reads each protocol once and keeps only
 * what it extracts, and the panel reads a step's text again when the focus comes back to it. `addIn` gives a step's
 * add-in type (its Name; the big Data is dropped), cached per blob without limit since names are tiny;
 * `addInText` gives the add-in with its Data, uncached (for showing one add-in).
 * `summary` gives a protocol's Preview summary (the big Data is dropped), cached per blob without limit.
 * Never throws: failures come back as `{ ok: false }` with a message that quotes no document text.
 */
import { decodeBytes } from '../core/edf.js';
import { errorText } from '../core/errors.js';
import { parseAscconv } from '../core/ascconv.js';
import { addInOf, addInTextOf } from '../core/addin.js';
import { previewOf } from '../core/preview.js';

/** @typedef {import('./sqlite.js').Db} Db */
/** @typedef {import('../core/ascconv.js').Block} Block */
/** @typedef {{ ok: true, blocks: Block[], warnings: string[] } | { ok: false, error: string }} Protocol */
/** @typedef {{ ok: true, text: string } | { ok: false, error: string }} ProtocolText */
/** @typedef {import('../core/addin.js').AddIn} AddIn */
/** @typedef {import('../core/addin.js').AddInText} AddInText */
/** @typedef {import('../core/preview.js').PreviewResult} ProtocolSummary */

/**
 * @typedef {object} FileSource
 * @property {(blob: string) => Promise<Protocol>} protocol the parsed protocol whose Content hash is `blob`
 * @property {(blob: string) => Promise<ProtocolText>} text the raw text of the protocol whose Content hash is `blob`, uncached
 * @property {(blob: string) => Promise<ProtocolSummary>} summary the Preview summary of the protocol whose Content hash is `blob` (no Data)
 * @property {(blob: string) => Promise<AddIn>} addIn the add-in whose Content hash is `blob`
 * @property {(blob: string) => Promise<AddInText>} addInText the same add-in with its Data, uncached
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
  /** @type {Map<string, Promise<AddIn>>} */
  const addIns = new Map();
  /** @type {Map<string, Promise<ProtocolSummary>>} */
  const summaries = new Map();

  /**
   * The decoded document whose Content hash is `blob`; throws on a bad document.
   * @param {string} blob @param {string} what named in errors
   */
  async function readDoc(blob, what) {
    const rows = db.rows('select Data from Content where Hash = ?', [blob]);
    if (rows.length === 0) return { ok: /** @type {const} */ (false), error: `${what} content is missing` };
    const data = rows[0][0];
    if (!(data instanceof Uint8Array)) return { ok: /** @type {const} */ (false), error: `${what} content is not a blob` };
    return { ok: /** @type {const} */ (true), doc: decodeBytes(await inflateRaw(data)) };
  }

  /** @param {string} blob @returns {Promise<ProtocolText>} */
  async function readText(blob) {
    try {
      const d = await readDoc(blob, 'protocol');
      if (!d.ok) return d;
      const { type, body } = d.doc;
      if (type !== 'EdfProtocolContent') return { ok: false, error: `expected a protocol, found ${type}` };
      if (typeof body.Data !== 'string') return { ok: false, error: 'protocol Data is not text' };
      return { ok: true, text: body.Data };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  }

  /** @param {string} blob @returns {Promise<ProtocolSummary>} */
  async function readSummary(blob) {
    try {
      const d = await readDoc(blob, 'protocol');
      return d.ok ? previewOf(d.doc) : d;
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  }

  /** @param {string} blob @returns {Promise<AddIn>} */
  async function readAddIn(blob) {
    try {
      const d = await readDoc(blob, 'add-in');
      return d.ok ? addInOf(d.doc) : d;
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  }

  /** @param {string} blob @returns {Promise<AddInText>} */
  async function readAddInText(blob) {
    try {
      const d = await readDoc(blob, 'add-in');
      return d.ok ? addInTextOf(d.doc) : d;
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
    summary(blob) {
      if (!open) return Promise.resolve({ ok: false, error: 'the file is closed' });
      let p = summaries.get(blob);
      if (!p) summaries.set(blob, p = readSummary(blob));
      return p;
    },
    addIn(blob) {
      if (!open) return Promise.resolve({ ok: false, error: 'the file is closed' });
      let p = addIns.get(blob);
      if (!p) addIns.set(blob, p = readAddIn(blob));
      return p;
    },
    addInText(blob) {
      return open ? readAddInText(blob) : Promise.resolve({ ok: false, error: 'the file is closed' });
    },
    close() {
      if (!open) return;
      open = false;
      cache.clear();
      addIns.clear();
      summaries.clear();
      close();
    },
  };
}

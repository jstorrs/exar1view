// @ts-check
/**
 * The type of a step's add-in, as the scanner shows it on the step: the Name of its
 * EdfAddInConfig document, an i18n resource key shortened to its last path segment; and with it the
 * document's Data, to show the add-in. Pure.
 */

/** @typedef {import('./json.js').Json} Json */
/**
 * `name`: what the step shows (null: the document names none); `raw`: the Name as stored.
 * @typedef {{ ok: true, name: string | null, raw: string | null } | { ok: false, error: string }} AddIn
 */
/**
 * An add-in with its Data (null: not text), the XML configuration the add-in runs with.
 * @typedef {{ ok: true, name: string | null, raw: string | null, data: string | null } | { ok: false, error: string }} AddInText
 */

const RESOURCE = 'i18n://';

/**
 * 'i18n://syngo.MR.ExamAddIn.Configurations/Resource/AutoAlignScout' → 'AutoAlignScout';
 * a plain name as is; empty or not a string → null.
 * @param {unknown} name
 * @returns {string | null}
 */
export function addInName(name) {
  if (typeof name !== 'string' || name === '') return null;
  if (!name.startsWith(RESOURCE)) return name;
  const last = name.slice(name.lastIndexOf('/') + 1);
  return last === '' ? name : last;
}

/**
 * The add-in of a decoded document (core/edf.js decodeBytes). Errors quote no document text.
 * @param {{ type: string, body: Record<string, Json> }} doc
 * @returns {AddIn}
 */
export function addInOf({ type, body }) {
  if (type !== 'EdfAddInConfigContent') return { ok: false, error: `expected an add-in, found ${type}` };
  const raw = typeof body.Name === 'string' ? body.Name : null;
  return { ok: true, name: addInName(raw), raw };
}

/**
 * The add-in of a decoded document with its Data. Errors quote no document text.
 * @param {{ type: string, body: Record<string, Json> }} doc
 * @returns {AddInText}
 */
export function addInTextOf(doc) {
  const a = addInOf(doc);
  return a.ok ? { ...a, data: typeof doc.body.Data === 'string' ? doc.body.Data : null } : a;
}

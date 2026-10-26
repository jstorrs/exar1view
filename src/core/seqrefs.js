// @ts-check
/**
 * Placeholder path references in Siemens protocol text, e.g. `tSequenceFileName = "%CustomerSeq%\foo"`
 * (for scanner-upgrade planning: `%CustomerSeq%` sequences have no guaranteed migration path). Pure.
 *
 * A reference is an ASCCONV `key = "value"` line whose value starts with a `%Name%` placeholder, or
 * any non-empty `tSequenceFileName`, which is kept even without a placeholder. Duplicates of one
 * (key, value) pair, such as sub-protocols repeating the sequence, count once, in first-seen order.
 * Values are raw text. Messages never quote document text.
 */

/** @typedef {'customer' | 'other' | 'service' | 'standard'} Category */
/** @typedef {{ key: string, value: string, placeholder: string | null }} Reference */
/** @typedef {{ ok: true, refs: Reference[] } | { ok: false, error: string }} ProtocolRefs */

export const CATEGORY_ORDER = /** @type {const} */ (['customer', 'other', 'service', 'standard']);

/** @type {Record<Category, string>} */
export const CATEGORY_LABEL = {
  customer: 'Customer (upgrade risk)',
  other: 'Unrecognised',
  service: 'Service',
  standard: 'Standard',
};

// One global multiline regex over the whole text instead of parseAscconv: about 0.2 s against 4.3 s
// on 1,043 protocols. The value sits in one pair of quotes, or a doubled pair; anything after the
// closing quote (a `# comment`) is ignored.
const ASSIGNMENT = /^[ \t]*([A-Za-z0-9_.[\]]+)[ \t]*=[ \t]*"{1,2}([^"\r\n]*)"/gm;
const PLACEHOLDER = /^%(\w+)%/;
const SEQUENCE_KEY = 'tSequenceFileName';

/**
 * The placeholder references in protocol text, deduplicated by (key, value).
 * @param {string} text
 * @returns {Reference[]}
 */
export function extractReferences(text) {
  /** @type {Map<string, Reference>} */
  const found = new Map();
  for (const [, key, value] of text.matchAll(ASSIGNMENT)) {
    const placeholder = PLACEHOLDER.exec(value)?.[1] ?? null;
    if (placeholder === null && (key !== SEQUENCE_KEY || value === '')) continue;
    const id = `${key}\0${value}`;
    if (!found.has(id)) found.set(id, { key, value, placeholder });
  }
  return [...found.values()];
}

/**
 * The upgrade-risk category of a placeholder name, case-insensitively.
 * @param {string | null} placeholder
 * @returns {Category}
 */
export function categoryOf(placeholder) {
  if (placeholder === null) return 'other';
  const name = placeholder.toLowerCase();
  if (name.startsWith('customer')) return 'customer';
  if (name.startsWith('service')) return 'service';
  if (name.startsWith('siemens') || name.startsWith('adjust') || name === 'measconst') return 'standard';
  return 'other';
}

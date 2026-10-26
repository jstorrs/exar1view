// @ts-check
/**
 * The "Customer sequences" report model (scanner-upgrade planning): which protocols reference
 * `%CustomerSeq%` or other non-standard sequences, and which specific references are in use. Pure.
 *
 * Inputs are the loaded files plus a scan result per protocol blob (see seqrefs.js). A step whose
 * protocol is missing, unread, unreadable, or names no sequence is listed as a gap, never as clean.
 * Program keys carry the file id (`f1:p:<guid>`), but programs are still counted by (fileId, key).
 */
import { displaySteps, measurementDetail, regionName } from './model.js';
import { CATEGORY_ORDER, categoryOf } from './seqrefs.js';

/** @typedef {import('./model.js').ExarFile} ExarFile */
/** @typedef {import('./seqrefs.js').Category} Category */
/** @typedef {import('./seqrefs.js').Reference} Reference */
/** @typedef {import('./seqrefs.js').ProtocolRefs} ProtocolRefs */
/** @typedef {{ fileId: string, fileName: string, path: string[], stepKey: string, programKey: string }} Use */
/** @typedef {{ ref: Reference, category: Category, uses: Use[] }} RefUses */
/** @typedef {RefUses & { programs: number }} RefEntry */
/** @typedef {{ category: Category, entries: RefEntry[] }} CategoryGroup */
/** @typedef {{ programKey: string, fileName: string, path: string[], refs: RefUses[] }} ProgramEntry */
/** @typedef {{ reason: 'no-protocol' | 'not-read' | 'unreadable' | 'no-sequence', error: string | null, use: Use }} Gap */
/** @typedef {{ byReference: CategoryGroup[], byProgram: ProgramEntry[], gaps: Gap[], files: number, protocols: number, steps: number }} SequenceReport */

/** Human label per gap reason, in display order (the panel's groups and the CSV's Reference column). @type {Readonly<Record<Gap['reason'], string>>} */
export const GAP_LABEL = {
  'no-protocol': 'No protocol',
  'not-read': 'Not read (scan cancelled or file added)',
  'unreadable': 'Could not be read',
  'no-sequence': 'No sequence file name',
};

/** @param {Reference} a @param {Reference} b */
const byValue = (a, b) => {
  const [la, lb] = [a.value.toLowerCase(), b.value.toLowerCase()];
  return la < lb ? -1 : la > lb ? 1 : a.value < b.value ? -1 : a.value > b.value ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
};

/** @param {RefUses} a @param {RefUses} b */
const byCategoryThenValue = (a, b) =>
  CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || byValue(a.ref, b.ref);

/**
 * Record a use of `ref` in `into`, keyed by (key, value).
 * @param {Map<string, RefUses>} into @param {Reference} ref @param {Use} use
 */
function addUse(into, ref, use) {
  const id = `${ref.key}\0${ref.value}`;
  const entry = into.get(id) ?? { ref, category: categoryOf(ref.placeholder), uses: [] };
  entry.uses.push(use);
  into.set(id, entry);
}

/**
 * @param {readonly ExarFile[]} files
 * @param {ReadonlyMap<string, ReadonlyMap<string, ProtocolRefs>>} scans fileId -> protocol blob -> result
 * @returns {SequenceReport}
 */
export function buildReport(files, scans) {
  /** @type {Map<string, RefUses>} */ const all = new Map();
  /** @type {ProgramEntry[]} */ const byProgram = [];
  /** @type {Gap[]} */ const gaps = [];
  /** @type {Set<string>} */ const protocols = new Set();
  let steps = 0;

  for (const file of files) {
    const scan = scans.get(file.id);
    for (const region of file.regions) for (const exam of region.exams) for (const program of exam.programs) {
      /** @type {Map<string, RefUses>} */ const own = new Map();
      for (const step of displaySteps(program.body)) {
        const detail = measurementDetail(step);
        if (!detail) continue;
        steps++;
        /** @type {Use} */
        const use = {
          fileId: file.id, fileName: file.name, stepKey: step.key, programKey: program.key,
          path: [regionName(region), exam.label, program.label, step.label],
        };
        // An empty ContentHash names no protocol either (seqscan.protocolBlobs skips it too).
        const blob = detail.protocolBlob || null;
        const result = blob === null ? null : scan?.get(blob);
        /** @param {Gap['reason']} reason @param {string | null} [error] */
        const gap = (reason, error = null) => gaps.push({ reason, error, use });
        if (blob === null) gap('no-protocol');
        else if (!result) gap('not-read');
        else if (!result.ok) gap('unreadable', result.error);
        else {
          protocols.add(`${file.id}\0${blob}`);
          if (!result.refs.some((r) => r.key === 'tSequenceFileName')) gap('no-sequence');
          for (const ref of result.refs) { addUse(all, ref, use); addUse(own, ref, use); }
        }
      }
      const risky = [...own.values()].filter((e) => e.category === 'customer' || e.category === 'other');
      if (risky.length > 0) {
        byProgram.push({
          programKey: program.key, fileName: file.name, path: [regionName(region), exam.label, program.label],
          refs: risky.sort(byCategoryThenValue),
        });
      }
    }
  }

  const byReference = CATEGORY_ORDER.map((category) => ({
    category,
    entries: [...all.values()].filter((e) => e.category === category).sort(byCategoryThenValue).map((e) => ({
      ...e, programs: new Set(e.uses.map((u) => `${u.fileId}\0${u.programKey}`)).size,
    })),
  })).filter((g) => g.entries.length > 0);

  return { byReference, byProgram, gaps, files: files.length, protocols: protocols.size, steps };
}

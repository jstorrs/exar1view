// @ts-check
/**
 * Analyze one file: read its protocols (for sequence references, seqrefs.js) and its add-ins
 * (addin.js) without blocking the page. Inflating is synchronous, so the run yields to the event
 * loop whenever a time slice is used up, reports progress, and stops when the signal aborts.
 * Results go into a per-file store that a later run resumes from, reading only what is missing.
 * IO (reading, yielding, the clock) is injected.
 */
import { displaySteps, measurementDetail } from './model.js';
import { addInBlobOf } from './stepinfo.js';
import { extractReferences } from './seqrefs.js';

/** @typedef {import('./model.js').ExarFile} ExarFile */
/** @typedef {import('./seqrefs.js').ProtocolRefs} ProtocolRefs */
/** @typedef {import('./addin.js').AddIn} AddIn */
/** @typedef {import('../platform/source.js').ProtocolText} ProtocolText */
/** @typedef {{ done: number, total: number }} AnalyzeProgress */
/**
 * By Content blob hash; `upgrades` are the protocol blobs with upgrade notes.
 * @typedef {{ refs: Map<string, ProtocolRefs>, addIns: Map<string, AddIn>, upgrades: Set<string> }} FileResults
 */

/** Let the event loop run (paint, input) between slices of work. */
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve));

/** @returns {FileResults} */
export const emptyResults = () => ({ refs: new Map(), addIns: new Map(), upgrades: new Set() });

/**
 * The distinct protocol blobs of a file's Measurement steps, in tree order.
 * @param {ExarFile} file
 * @returns {string[]}
 */
export function protocolBlobs(file) {
  /** @type {Set<string>} */
  const blobs = new Set();
  for (const region of file.regions) for (const exam of region.exams) for (const program of exam.programs) {
    for (const step of displaySteps(program.body)) {
      const blob = measurementDetail(step)?.protocolBlob;
      if (blob) blobs.add(blob);
    }
  }
  return [...blobs];
}

/**
 * The distinct add-in blobs of a file's steps, in tree order.
 * @param {ExarFile} file
 * @returns {string[]}
 */
export function addInBlobs(file) {
  /** @type {Set<string>} */
  const blobs = new Set();
  for (const region of file.regions) for (const exam of region.exams) for (const program of exam.programs) {
    for (const step of displaySteps(program.body)) {
      const blob = addInBlobOf(step);
      if (blob) blobs.add(blob);
    }
  }
  return [...blobs];
}

/**
 * How many protocols and add-ins of `file` are not in `results` yet.
 * @param {ExarFile} file
 * @param {FileResults} results
 */
export const missingCount = (file, results) =>
  protocolBlobs(file).filter((b) => !results.refs.has(b)).length + addInBlobs(file).filter((b) => !results.addIns.has(b)).length;

/**
 * Read the protocols and add-ins missing from `results` and store them there. A read that
 * resolves after an abort is dropped, so a closed file's errors never reach the results.
 * @param {object} args
 * @param {ExarFile} args.file
 * @param {FileResults} args.results filled in place
 * @param {(blob: string) => Promise<ProtocolText>} args.readText never rejects
 * @param {(blob: string) => Promise<AddIn>} args.readAddIn never rejects
 * @param {AbortSignal} args.signal
 * @param {(p: AnalyzeProgress) => void} args.onProgress
 * @param {() => Promise<void>} [args.yieldNow]
 * @param {() => number} [args.now] milliseconds
 * @param {number} [args.sliceMs] longest run between yields
 * @returns {Promise<'done' | 'cancelled'>}
 */
export async function analyzeFile({
  file, results, readText, readAddIn, signal, onProgress, yieldNow = yieldToEventLoop, now = () => performance.now(), sliceMs = 25,
}) {
  /** @type {Array<() => Promise<void>>} reads one blob and stores it unless aborted meanwhile */
  const todo = [
    ...protocolBlobs(file).filter((b) => !results.refs.has(b)).map((blob) => async () => {
      const t = await readText(blob);
      if (signal.aborted) return;
      results.refs.set(blob, t.ok ? { ok: true, refs: extractReferences(t.text) } : t);
      if (t.ok && t.upgrade !== null) results.upgrades.add(blob);
    }),
    ...addInBlobs(file).filter((b) => !results.addIns.has(b)).map((blob) => async () => {
      const a = await readAddIn(blob);
      if (!signal.aborted) results.addIns.set(blob, a);
    }),
  ];
  const total = todo.length;
  let done = 0;
  onProgress({ done, total });
  let sliceStart = now();
  for (const read of todo) {
    if (signal.aborted) return 'cancelled';
    await read();
    if (signal.aborted) return 'cancelled';
    done++;
    if (now() - sliceStart >= sliceMs) {
      onProgress({ done, total });
      await yieldNow();
      if (signal.aborted) return 'cancelled';
      sliceStart = now();
    }
  }
  onProgress({ done, total });
  return 'done';
}

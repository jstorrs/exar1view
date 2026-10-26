// @ts-check
/**
 * Scan the measurement protocols of open files for sequence references (seqrefs.js), without
 * blocking the page: inflating is synchronous, so the scan yields to the event loop whenever a
 * time slice is used up, reports progress, and stops when the signal aborts. Results go into a
 * per-file cache that a later run resumes from, reading only what is missing. IO (reading text,
 * yielding, the clock) is injected.
 */
import { displaySteps, measurementDetail } from './model.js';
import { extractReferences } from './seqrefs.js';

/** @typedef {import('./model.js').ExarFile} ExarFile */
/** @typedef {import('./seqrefs.js').ProtocolRefs} ProtocolRefs */
/** @typedef {import('../platform/source.js').ProtocolText} ProtocolText */
/** @typedef {{ done: number, total: number }} ScanProgress */

/** Let the event loop run (paint, input) between slices of work. */
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve));

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
 * Read the protocols missing from `cache` and store their references there. A read that resolves
 * after an abort is dropped, so a closed file's errors never reach the cache.
 * @param {object} args
 * @param {readonly ExarFile[]} args.files
 * @param {Map<string, Map<string, ProtocolRefs>>} args.cache by file id, then blob; filled in place
 * @param {(fileId: string, blob: string) => Promise<ProtocolText>} args.readText never rejects
 * @param {AbortSignal} args.signal
 * @param {(p: ScanProgress) => void} args.onProgress
 * @param {() => Promise<void>} [args.yieldNow]
 * @param {() => number} [args.now] milliseconds
 * @param {number} [args.sliceMs] longest run between yields
 * @returns {Promise<'done' | 'cancelled'>}
 */
export async function scanProtocols({
  files, cache, readText, signal, onProgress, yieldNow = yieldToEventLoop, now = () => performance.now(), sliceMs = 25,
}) {
  const todo = files.flatMap((f) => protocolBlobs(f).filter((b) => !cache.get(f.id)?.has(b)).map((blob) => ({ id: f.id, blob })));
  const total = todo.length;
  let done = 0;
  onProgress({ done, total });
  let sliceStart = now();
  for (const { id, blob } of todo) {
    if (signal.aborted) return 'cancelled';
    const t = await readText(id, blob);
    if (signal.aborted) return 'cancelled';
    let inner = cache.get(id);
    if (!inner) cache.set(id, (inner = new Map()));
    inner.set(blob, t.ok ? { ok: true, refs: extractReferences(t.text) } : t);
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

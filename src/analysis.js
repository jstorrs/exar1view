// @ts-check
/**
 * Per-file analyses (core/analyze.js), run one file at a time in the order asked for. A file's
 * results are kept across runs, so a cancelled analysis resumes where it stopped. What the panes
 * and the Customer sequences report see is a snapshot published when a run ends (done, cancelled
 * or failed), never the results while they fill. Reading, yielding and the clock are injected.
 */
import { analyzeFile, emptyResults, missingCount } from './core/analyze.js';
import { buildReport } from './core/seqreport.js';
import { NO_MARKS, markedKeys } from './core/seqmarks.js';
import { fileById } from './core/workspace.js';

/** @typedef {import('./core/workspace.js').Workspace} Workspace */
/** @typedef {import('./core/analyze.js').FileResults} FileResults */
/** @typedef {import('./core/analyze.js').AnalyzeProgress} AnalyzeProgress */
/** @typedef {import('./core/seqrefs.js').ProtocolRefs} ProtocolRefs */
/** @typedef {import('./core/seqreport.js').SequenceReport} SequenceReport */
/** @typedef {import('./core/addin.js').AddIn} AddIn */
/** @typedef {import('./platform/source.js').ProtocolText} ProtocolText */
/** @typedef {'none'|'queued'|'running'|'partial'|'done'} AnalysisState */
/**
 * A snapshot of one file's results; `refs` (by protocol blob) feeds the all-files report.
 * @typedef {{ report: SequenceReport, marks: ReadonlySet<string>, addIns: ReadonlyMap<string, AddIn>, refs: ReadonlyMap<string, ProtocolRefs>, complete: boolean }} Published
 */
/** @typedef {'queued'|'dequeued'|'started'|'done'|'cancelled'} AnalysisEvent */
/** @typedef {{ results: FileResults, published: Published | null }} Entry */

/** Never silent: rethrow outside the caller's stack. @param {string} _fileId @param {unknown} error */
const rethrowLater = (_fileId, error) => queueMicrotask(() => { throw error; });

/**
 * @param {object} args
 * @param {() => Workspace} args.getWorkspace
 * @param {(fileId: string, blob: string) => Promise<ProtocolText>} args.readText never rejects
 * @param {(fileId: string, blob: string) => Promise<AddIn>} args.readAddIn never rejects
 * @param {(fileId: string, p: AnalyzeProgress, queued: number) => void} args.onProgress
 * @param {(fileId: string, e: AnalysisEvent) => void} args.onChange
 * @param {(fileId: string, error: unknown) => void} [args.onError] a run that throws ends (publishing what it read, no event),
 *   then this is called, so the file's state is already settled; the queue goes on
 * @param {() => Promise<void>} [args.yieldNow]
 * @param {() => number} [args.now] milliseconds
 */
export function createAnalyses({ getWorkspace, readText, readAddIn, onProgress, onChange, onError = rethrowLater, yieldNow, now }) {
  /** @type {Map<string, Entry>} */
  const entries = new Map();
  /** File ids waiting to run, in order. @type {string[]} */
  const queue = [];
  /** @type {{ fileId: string, ctrl: AbortController, progress: AnalyzeProgress } | null} */
  let current = null;
  /** Separate from `current`: a cancelled run's loop is still awaiting its last read. */
  let draining = false;
  /** Union of the published marks; the same object until a publish or close. */
  let marks = NO_MARKS;
  /** Report over every published file, built on demand for `reportWs`. @type {SequenceReport | null} */
  let report = null;
  /** @type {Workspace | null} */
  let reportWs = null;

  /** Report an error; a throwing `onError` is rethrown later, never into the bookkeeping. @param {string} id @param {unknown} error */
  const fail = (id, error) => {
    try {
      onError(id, error);
    } catch (again) {
      rethrowLater(id, again);
    }
  };

  /** Tell the caller, reporting a throw instead of letting it break the bookkeeping. @param {string} id @param {AnalysisEvent} e */
  const emit = (id, e) => {
    try {
      onChange(id, e);
    } catch (error) {
      fail(id, error);
    }
  };

  const refreshMarks = () => {
    /** @type {Set<string>} */ const all = new Set();
    for (const e of entries.values()) for (const k of e.published?.marks ?? []) all.add(k);
    marks = all.size === 0 ? NO_MARKS : all;
    report = null;
  };

  /** Snapshot a file's results for the panes and the report. @param {string} id */
  const publish = (id) => {
    const entry = entries.get(id);
    const ws = getWorkspace();
    const file = fileById(ws, id);
    if (!entry || !file) return;
    const refs = new Map(entry.results.refs);
    const fileReport = buildReport([file], new Map([[id, refs]]));
    entry.published = {
      report: fileReport,
      marks: markedKeys(ws, fileReport),
      addIns: new Map(entry.results.addIns),
      refs,
      complete: missingCount(file, entry.results) === 0,
    };
    refreshMarks();
  };

  /** @param {string} id @returns {AnalysisState} */
  const state = (id) => {
    if (current?.fileId === id) return 'running';
    if (queue.includes(id)) return 'queued';
    const published = entries.get(id)?.published;
    return !published ? 'none' : published.complete ? 'done' : 'partial';
  };

  /** @param {string} id @returns {boolean} whether it was queued */
  const dequeue = (id) => {
    const i = queue.indexOf(id);
    if (i < 0) return false;
    queue.splice(i, 1);
    return true;
  };

  async function drain() {
    draining = true;
    try {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const file = fileById(getWorkspace(), id);
        const entry = entries.get(id);
        if (!file || !entry) continue;
        const ctrl = new AbortController();
        const run = { fileId: id, ctrl, progress: { done: 0, total: 0 } };
        current = run;
        try {
          emit(id, 'started');
          await analyzeFile({
            file, results: entry.results, signal: ctrl.signal, yieldNow, now,
            readText: (b) => readText(id, b),
            readAddIn: (b) => readAddIn(id, b),
            onProgress: (p) => {
              if (current !== run) return;
              run.progress = p;
              onProgress(id, p, queue.length);
            },
          });
          // Cancelled or closed meanwhile: that already published (or dropped) the file.
          if (current !== run) continue;
          current = null;
          publish(id);
          emit(id, 'done');
        } catch (error) {
          // Settle the file first, so the caller sees it 'partial' (or 'done'), not 'running'.
          /** @type {unknown[]} */ const errors = [error];
          if (current === run) {
            current = null;
            ctrl.abort();
            try {
              publish(id);
            } catch (again) {
              errors.push(again);
            }
          }
          for (const e of errors) fail(id, e);
        }
      }
    } finally {
      draining = false;
    }
  }

  /** @param {string} id */
  function cancel(id) {
    if (dequeue(id)) {
      emit(id, 'dequeued');
    } else if (current?.fileId === id) {
      current.ctrl.abort();
      current = null;
      publish(id);
      emit(id, 'cancelled');
    }
  }

  return {
    state,
    /** @param {string} id @returns {Published | null} */
    published: (id) => entries.get(id)?.published ?? null,
    /** Queue `id` unless it is queued, running, done or not open. @param {string} id */
    start(id) {
      const s = state(id);
      if (s === 'queued' || s === 'running' || s === 'done' || !fileById(getWorkspace(), id)) return;
      if (!entries.has(id)) entries.set(id, { results: emptyResults(), published: null });
      queue.push(id);
      emit(id, 'queued');
      if (!draining) drain().catch((error) => fail(id, error));
    },
    cancel,
    cancelAll() {
      const running = current?.fileId;
      for (const id of queue.splice(0)) emit(id, 'dequeued');
      if (running !== undefined) cancel(running);
    },
    /** Forget a closed file; no event. @param {string} id */
    fileClosed(id) {
      dequeue(id);
      if (current?.fileId === id) {
        current.ctrl.abort();
        current = null;
      }
      if (entries.delete(id)) refreshMarks();
    },
    /** @returns {{ fileId: string, done: number, total: number, queued: number } | null} */
    running: () => (current ? { fileId: current.fileId, ...current.progress, queued: queue.length } : null),
    marks: () => marks,
    /** The Customer sequences report over every open file with published results, in workspace order. */
    report() {
      const ws = getWorkspace();
      if (!report || reportWs !== ws) {
        const shown = ws.files.flatMap((file) => {
          const published = entries.get(file.id)?.published;
          return published ? [{ file, refs: published.refs }] : [];
        });
        report = buildReport(shown.map((s) => s.file), new Map(shown.map((s) => [s.file.id, s.refs])));
        reportWs = ws;
      }
      return report;
    },
  };
}

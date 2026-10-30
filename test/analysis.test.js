// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_WORKSPACE, addFile, removeFile } from '../src/core/workspace.js';
import { NO_MARKS } from '../src/core/seqmarks.js';
import { createAnalyses } from '../src/analysis.js';

/** @typedef {import('../src/core/model.js').ExarFile} ExarFile */
/** @typedef {import('../src/core/model.js').Step} Step */
/** @typedef {import('../src/analysis.js').AnalysisEvent} AnalysisEvent */
/** @typedef {ReturnType<typeof createAnalyses>} Analyses */

/** @param {string} key @param {string} blob @param {string | null} [addIn] @returns {Step} */
const step = (key, blob, addIn = null) => ({
  key, ids: { element: key, instance: key, object: key }, label: key, comment: null, tags: {}, rank: null, problems: [],
  kind: 'Measurement',
  detail: { protocolBlob: blob, protocolHash: null, addInBlob: addIn, bodyPart: null, laterality: null, imageComment: null, openBeforeStart: null },
});

/** One file whose single program has `steps`. @param {string} id @param {Step[]} steps @returns {ExarFile} */
const file = (id, steps) => ({
  id, name: `${id}.exar1`, size: 0, baseline: '', changeset: { id: '', dateTime: '', comment: '' }, problems: [],
  regions: [{ key: `${id}:r:1`, label: 'Brain', comment: null, tree: null, exams: [
    { key: `${id}:e:1`, label: 'Routine', comment: null, programs: [{
      key: `${id}:p:1`, ids: { element: 'p', object: 'p' }, label: 'P', comment: null, tags: {}, path: [],
      body: steps.map((s) => ({ type: 'step', step: s })), conditions: [], copyRefs: [], order: 'links', problems: [],
    }] },
  ] }],
});

/** f1 reads cust, std, a1, a2 in that order. */
const f1 = file('f1', [step('f1:s:1', 'cust', 'a1'), step('f1:s:2', 'std'), step('f1:s:3', 'std', 'a2')]);
const f2 = file('f2', [step('f2:s:1', 'cust2')]);
const f3 = file('f3', [step('f3:s:1', 'std')]);
const F1_READS = ['f1:cust', 'f1:std', 'f1:a1', 'f1:a2'];
const src = { name: 'x', size: 0, lastModified: 0 };

/** @type {Record<string, string>} */
const TEXTS = {
  cust: 'tSequenceFileName = "%CustomerSeq%\\a"',
  cust2: 'tSequenceFileName = "%CustomerSeq%\\b"',
  std: 'tSequenceFileName = "%SiemensSeq%\\c"',
};

/** Let pending promise chains run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A controller over f1, f2 and f3 whose reads wait until `next()` resolves the oldest one.
 * The clock advances a whole slice per call, so every read reports progress. `hooks` run inside
 * the callbacks (after recording) and may throw. The protocols in `notes` have upgrade notes.
 * @param {{ change?: (a: Analyses, id: string, e: AnalysisEvent) => void, progress?: (id: string) => void, error?: (a: Analyses, id: string) => void }} [hooks]
 * @param {ReadonlySet<string>} [notes]
 */
function setup(hooks = {}, notes = new Set()) {
  let ws = addFile(addFile(addFile(EMPTY_WORKSPACE, f1, src), f2, src), f3, src);
  /** @type {string[]} */ const reads = [];
  /** @type {string[]} */ const events = [];
  /** @type {Array<{ fileId: string, error: unknown }>} */ const errors = [];
  /** @type {Array<{ fileId: string, done: number, total: number, queued: number }>} */ const progress = [];
  /** @type {Array<() => void>} */ const pending = [];
  let t = 0;
  /** @type {Analyses} */
  const analyses = createAnalyses({
    getWorkspace: () => ws,
    readText: (fileId, blob) => {
      reads.push(`${fileId}:${blob}`);
      return new Promise((resolve) => pending.push(() => resolve({ ok: true, text: TEXTS[blob] ?? '', upgrade: notes.has(blob) ? 'note' : null })));
    },
    readAddIn: (fileId, blob) => {
      reads.push(`${fileId}:${blob}`);
      return new Promise((resolve) => pending.push(() => resolve({ ok: true, name: `Name ${blob}`, raw: null })));
    },
    onProgress: (fileId, p, queued) => {
      progress.push({ fileId, ...p, queued });
      hooks.progress?.(fileId);
    },
    onChange: (fileId, e) => {
      events.push(`${fileId}:${e}`);
      hooks.change?.(analyses, fileId, e);
    },
    onError: (fileId, error) => {
      errors.push({ fileId, error });
      hooks.error?.(analyses, fileId);
    },
    yieldNow: async () => {},
    now: () => (t += 100),
  });
  /** Resolve the oldest pending read and let the run move on. */
  const next = async () => {
    assert.ok(pending.length <= 1, 'reads never overlap');
    const resolve = pending.shift();
    assert.ok(resolve, 'a read is pending');
    resolve();
    await settle();
  };
  const finish = async () => { while (pending.length) await next(); };
  return {
    analyses, reads, events, errors, progress, pending, next, finish,
    /** Take a file out of the workspace only. @param {string} id */
    drop(id) { ws = removeFile(ws, id); },
    /** @param {string} id */
    close(id) { ws = removeFile(ws, id); analyses.fileClosed(id); },
  };
}

test('a file goes from none through queued and running to done', async () => {
  const { analyses, events, reads, finish } = setup();
  assert.equal(analyses.state('f1'), 'none');
  assert.equal(analyses.published('f1'), null);
  analyses.start('f1');
  assert.deepEqual(events, ['f1:queued', 'f1:started']);
  assert.equal(analyses.state('f1'), 'running');
  assert.equal(analyses.running()?.fileId, 'f1');
  await finish();
  assert.deepEqual(reads, F1_READS);
  assert.deepEqual(events, ['f1:queued', 'f1:started', 'f1:done']);
  assert.equal(analyses.state('f1'), 'done');
  assert.equal(analyses.running(), null);
  const pub = analyses.published('f1');
  assert.ok(pub?.complete);
  assert.deepEqual(pub.addIns.get('a1'), { ok: true, name: 'Name a1', raw: null });
  assert.ok(pub.marks.custom.has('f1:s:1') && !pub.marks.custom.has('f1:s:2'));
  assert.ok(analyses.marks().custom.has('f1:s:1'));
  assert.equal(pub.upgrades.size, 0);
  assert.equal(analyses.marks().upgrade.size, 0);
});

test('protocols with upgrade notes are published and marked until their file closes', async () => {
  const { analyses, finish, close } = setup({}, new Set(['std']));
  analyses.start('f1');
  await finish();
  const pub = analyses.published('f1');
  assert.deepEqual([...(pub?.upgrades ?? [])], ['std']);
  assert.deepEqual([...analyses.marks().upgrade].sort(), ['f1:e:1', 'f1:p:1', 'f1:r:1', 'f1:s:2', 'f1:s:3']);
  assert.ok(analyses.marks().custom.has('f1:s:1'));
  close('f1');
  assert.equal(analyses.marks(), NO_MARKS);
});

test('starts run first in, first out, never interleaved', async () => {
  const { analyses, events, reads, progress, finish } = setup();
  analyses.start('f1');
  analyses.start('f2');
  analyses.start('f3');
  assert.equal(analyses.state('f2'), 'queued');
  assert.equal(analyses.state('f3'), 'queued');
  await finish();
  assert.deepEqual(reads, [...F1_READS, 'f2:cust2', 'f3:std']);
  assert.deepEqual(events, [
    'f1:queued', 'f1:started', 'f2:queued', 'f3:queued', 'f1:done', 'f2:started', 'f2:done', 'f3:started', 'f3:done',
  ]);
  assert.equal(progress.filter((p) => p.fileId === 'f1').at(-1)?.queued, 2);
  assert.equal(analyses.state('f3'), 'done');
});

test('cancelling mid-run publishes a partial snapshot and a restart reads only what is missing', async () => {
  const { analyses, events, reads, next, finish } = setup();
  analyses.start('f1');
  await next();
  analyses.cancel('f1');
  assert.equal(events.at(-1), 'f1:cancelled');
  assert.equal(analyses.state('f1'), 'partial');
  assert.equal(analyses.running(), null);
  const pub = analyses.published('f1');
  assert.ok(pub && !pub.complete);
  assert.ok(pub.marks.custom.has('f1:s:1'));
  assert.equal(pub.addIns.size, 0);
  await finish(); // the read in flight at cancel resolves and is dropped
  assert.equal(analyses.published('f1'), pub);
  reads.length = 0;
  analyses.start('f1');
  await finish();
  assert.deepEqual(reads, ['f1:std', 'f1:a1', 'f1:a2']);
  assert.equal(analyses.state('f1'), 'done');
  assert.ok(analyses.published('f1')?.complete);
});

test('nothing published changes while a resumed run fills the results', async () => {
  const { analyses, next, finish } = setup();
  analyses.start('f1');
  await next();
  analyses.cancel('f1');
  await finish();
  const pub = analyses.published('f1');
  const marks = analyses.marks();
  const report = analyses.report();
  assert.ok(pub);
  assert.equal(pub.report.gaps.length, 2); // both std steps not read
  analyses.start('f1');
  await next(); // std
  await next(); // a1
  assert.equal(analyses.state('f1'), 'running');
  assert.equal(analyses.published('f1'), pub);
  assert.equal(pub.addIns.size, 0);
  assert.equal(pub.refs.size, 1);
  assert.equal(pub.report.gaps.length, 2);
  assert.equal(analyses.marks(), marks);
  assert.equal(analyses.report(), report);
  assert.equal(report.gaps.length, 2);
  await finish();
  assert.notEqual(analyses.published('f1'), pub);
  assert.notEqual(analyses.marks(), marks);
  assert.equal(analyses.report().gaps.length, 0);
});

test('starting a done, queued or running file, or one not open, does nothing', async () => {
  const { analyses, events, reads, finish } = setup();
  analyses.start('f1');
  analyses.start('f1');
  analyses.start('f2');
  analyses.start('f2');
  analyses.start('f9');
  assert.deepEqual(events, ['f1:queued', 'f1:started', 'f2:queued']);
  await finish();
  events.length = 0;
  reads.length = 0;
  analyses.start('f1');
  assert.deepEqual(events, []);
  assert.deepEqual(reads, []);
});

test('cancelling a queued file dequeues it unread', async () => {
  const { analyses, events, reads, finish } = setup();
  analyses.start('f1');
  analyses.start('f2');
  analyses.cancel('f2');
  assert.equal(events.at(-1), 'f2:dequeued');
  assert.equal(analyses.state('f2'), 'none');
  await finish();
  assert.ok(!reads.some((r) => r.startsWith('f2:')));
  assert.equal(analyses.state('f1'), 'done');
});

test('cancelAll dequeues the waiting files and cancels the running one', async () => {
  const { analyses, events, reads, next, finish } = setup();
  analyses.start('f1');
  analyses.start('f2');
  await next();
  analyses.cancelAll();
  assert.deepEqual(events.slice(-2), ['f2:dequeued', 'f1:cancelled']);
  assert.equal(analyses.state('f1'), 'partial');
  assert.equal(analyses.state('f2'), 'none');
  assert.equal(analyses.running(), null);
  await finish();
  assert.deepEqual(reads, ['f1:cust', 'f1:std']);
});

test('closing the running file publishes nothing, drops its marks and moves on to the next', async () => {
  const { analyses, events, next, finish, close } = setup();
  analyses.start('f1');
  await next();
  analyses.cancel('f1');
  await finish();
  assert.ok(analyses.marks().custom.has('f1:s:1'));
  analyses.start('f1');
  analyses.start('f2');
  events.length = 0;
  close('f1');
  assert.equal(analyses.published('f1'), null);
  assert.equal(analyses.state('f1'), 'none');
  assert.equal(analyses.marks(), NO_MARKS);
  assert.deepEqual(events, []);
  await finish();
  assert.deepEqual(events, ['f2:started', 'f2:done']);
  assert.deepEqual([...analyses.marks().custom].filter((k) => k.endsWith(':s:1')), ['f2:s:1']);
});

test('closing a queued file while another runs forgets it', async () => {
  const { analyses, events, reads, finish, close } = setup();
  analyses.start('f1');
  analyses.start('f2');
  close('f2');
  assert.equal(analyses.state('f2'), 'none');
  assert.equal(analyses.running()?.queued, 0);
  await finish();
  assert.deepEqual(reads, F1_READS);
  assert.ok(!events.some((e) => e.startsWith('f2:') && e !== 'f2:queued'));
  assert.equal(analyses.state('f1'), 'done');
});

test('a start from inside onChange queues behind the running file', async () => {
  const { analyses, reads, finish } = setup({
    change: (a, id, e) => { if (id === 'f1' && e === 'started') a.start('f2'); },
  });
  analyses.start('f1');
  assert.equal(analyses.state('f2'), 'queued');
  await finish();
  assert.deepEqual(reads, [...F1_READS, 'f2:cust2']);
  assert.equal(analyses.state('f2'), 'done');
});

test('a cancelled file restarted behind another runs after it and reads only what is missing', async () => {
  const { analyses, reads, next, finish } = setup();
  analyses.start('f1');
  await next();
  analyses.cancel('f1');
  analyses.start('f2');
  analyses.start('f1');
  await finish();
  assert.deepEqual(reads, ['f1:cust', 'f1:std', 'f2:cust2', 'f1:std', 'f1:a1', 'f1:a2']);
  assert.equal(analyses.state('f1'), 'done');
  assert.equal(analyses.state('f2'), 'done');
});

test('marks() keeps its identity across progress and changes on publish', async () => {
  const { analyses, progress, next, finish } = setup();
  const before = analyses.marks();
  assert.equal(before, NO_MARKS);
  analyses.start('f1');
  await next();
  await next();
  assert.ok(progress.length >= 3);
  assert.equal(analyses.marks(), before);
  assert.deepEqual(analyses.running(), { fileId: 'f1', done: 2, total: 4, queued: 0 });
  await finish();
  const after = analyses.marks();
  assert.notEqual(after, before);
  assert.equal(analyses.marks(), after);
});

test('a start right after a cancel waits for the read in flight instead of starting a second loop', async () => {
  const { analyses, reads, pending, finish } = setup();
  analyses.start('f2');
  analyses.cancel('f2');
  analyses.start('f2');
  analyses.start('f1');
  await settle();
  assert.deepEqual(reads, ['f2:cust2']);
  assert.equal(pending.length, 1);
  await finish(); // next() asserts reads never overlap
  assert.deepEqual(reads, ['f2:cust2', 'f2:cust2', ...F1_READS]);
  assert.equal(analyses.state('f2'), 'done');
  assert.equal(analyses.state('f1'), 'done');
});

test('report() covers every published file and keeps its identity until one changes', async () => {
  const { analyses, finish, close } = setup();
  const empty = analyses.report();
  assert.equal(empty.files, 0);
  analyses.start('f1');
  analyses.start('f2');
  await finish();
  const both = analyses.report();
  assert.equal(both.files, 2);
  assert.deepEqual(both.byProgram.map((p) => p.programKey), ['f1:p:1', 'f2:p:1']);
  assert.equal(analyses.report(), both);
  close('f1');
  const one = analyses.report();
  assert.notEqual(one, both);
  assert.equal(one.files, 1);
  assert.equal(analyses.report(), one);
});

test('report() leaves out a closed file whichever is told first, the workspace or the controller', async () => {
  const { analyses, finish, drop } = setup();
  analyses.start('f1');
  analyses.start('f2');
  await finish();
  assert.equal(analyses.report().files, 2);
  drop('f1');
  assert.equal(analyses.report().files, 1);
  analyses.fileClosed('f1');
  assert.equal(analyses.report().files, 1);
  analyses.fileClosed('f2');
  assert.equal(analyses.report().files, 0);
  drop('f2');
  assert.equal(analyses.report().files, 0);
});

/** @param {Parameters<typeof setup>[0]} hooks */
async function throwingF1(hooks) {
  const s = setup(hooks);
  s.analyses.start('f1');
  s.analyses.start('f2');
  await settle(); // f1 may fail before its first read
  await s.finish();
  assert.notEqual(s.analyses.state('f1'), 'running');
  assert.notEqual(s.analyses.state('f1'), 'queued');
  assert.equal(s.analyses.state('f2'), 'done');
  assert.equal(s.analyses.running(), null);
  assert.ok(s.errors.length >= 1);
  assert.ok(s.errors.every((e) => e.fileId === 'f1' && e.error instanceof Error && e.error.message === 'boom'));
  return s;
}
const boom = () => { throw new Error('boom'); };

test('an onProgress that throws ends that run with what it read; the queue goes on', async () => {
  const { analyses, reads } = await throwingF1({ progress: (id) => { if (id === 'f1') boom(); } });
  assert.ok(!reads.includes('f1:std'));
  assert.equal(analyses.state('f1'), 'partial');
  assert.equal(analyses.published('f1')?.complete, false);
});

test('an onChange that throws on started or queued is reported and the run goes on', async () => {
  for (const event of ['started', 'queued']) {
    const { analyses, errors } = await throwingF1({ change: (_a, id, e) => { if (id === 'f1' && e === event) boom(); } });
    assert.equal(errors.length, 1);
    assert.equal(analyses.state('f1'), 'done');
  }
});

test('onError comes after the failed run is settled and published', async () => {
  /** @type {Array<{ state: string, running: unknown, complete: boolean | undefined }>} */ const seen = [];
  await throwingF1({
    progress: (id) => { if (id === 'f1') boom(); },
    error: (a, id) => {
      seen.push({ state: a.state(id), running: a.running(), complete: a.published(id)?.complete });
    },
  });
  assert.ok(seen.length >= 1);
  assert.deepEqual(seen[0], { state: 'partial', running: null, complete: false });
});

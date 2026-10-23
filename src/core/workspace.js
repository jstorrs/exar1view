// @ts-check
/**
 * The loaded files (pure). A workspace is immutable: every operation returns a new one.
 *
 * File ids are 'f1', 'f2', ... in load order and never reused within a session, so a key
 * (which starts with its file's id, see model.js) can never point at a later file after
 * its own was closed. Duplicates are recognised by the browser File's name, size and
 * lastModified, which are kept beside each file.
 */
import { displaySteps } from './model.js';

/** @typedef {import('./model.js').ExarFile} ExarFile */
/** @typedef {import('./model.js').Region} Region */
/** @typedef {import('./model.js').Exam} Exam */
/** @typedef {import('./model.js').Program} Program */
/** @typedef {import('./model.js').Step} Step */
/** @typedef {import('./model.js').Problem} Problem */

/** @typedef {{ name: string, size: number, lastModified: number }} FileSource */

/**
 * `issued` is the highest file number handed out so far.
 * @typedef {{ files: readonly ExarFile[], sources: ReadonlyMap<string, FileSource>, issued: number }} Workspace
 */

/**
 * A node found by key, with its ancestors from the file down.
 * @typedef {{ level: 'file', node: ExarFile, ancestors: [] }
 *   | { level: 'region', node: Region, ancestors: [ExarFile] }
 *   | { level: 'exam', node: Exam, ancestors: [ExarFile, Region] }
 *   | { level: 'program', node: Program, ancestors: [ExarFile, Region, Exam] }
 *   | { level: 'step', node: Step, ancestors: [ExarFile, Region, Exam, Program] }} Located
 */

/** @type {Workspace} */
export const EMPTY_WORKSPACE = Object.freeze({ files: [], sources: new Map(), issued: 0 });

/** @param {string} id */
const fileNumber = (id) => {
  const m = /^f([1-9]\d*)$/.exec(id);
  return m ? Number(m[1]) : 0;
};

/**
 * The id the next loaded file gets.
 * @param {Workspace} ws
 */
export const nextFileId = (ws) => `f${ws.issued + 1}`;

/**
 * The open file loaded from the same browser File (name, size and lastModified), if any.
 * @param {Workspace} ws
 * @param {FileSource} source
 * @returns {ExarFile | null}
 */
export function findDuplicate(ws, source) {
  return ws.files.find((f) => {
    const s = ws.sources.get(f.id);
    return s !== undefined && s.name === source.name && s.size === source.size && s.lastModified === source.lastModified;
  }) ?? null;
}

/**
 * Append a loaded file. A file whose id is already open leaves the workspace unchanged.
 * @param {Workspace} ws
 * @param {ExarFile} file
 * @param {FileSource} source
 * @returns {Workspace}
 */
export function addFile(ws, file, source) {
  if (ws.files.some((f) => f.id === file.id)) return ws;
  return {
    files: [...ws.files, file],
    sources: new Map(ws.sources).set(file.id, source),
    issued: Math.max(ws.issued, fileNumber(file.id)),
  };
}

/**
 * Close a file. Its id stays issued.
 * @param {Workspace} ws
 * @param {string} fileId
 * @returns {Workspace}
 */
export function removeFile(ws, fileId) {
  if (!ws.files.some((f) => f.id === fileId)) return ws;
  const sources = new Map(ws.sources);
  sources.delete(fileId);
  return { files: ws.files.filter((f) => f.id !== fileId), sources, issued: ws.issued };
}

/** @param {Workspace} ws @param {string | null} fileId */
export const fileById = (ws, fileId) => ws.files.find((f) => f.id === fileId) ?? null;

/** Per-file key index, built on first lookup. @type {WeakMap<ExarFile, Map<string, Located>>} */
const indexes = new WeakMap();

/** @param {ExarFile} file @returns {Map<string, Located>} */
function indexOf(file) {
  let index = indexes.get(file);
  if (index) return index;
  index = new Map();
  index.set(file.id, { level: 'file', node: file, ancestors: [] });
  for (const region of file.regions) {
    index.set(region.key, { level: 'region', node: region, ancestors: [file] });
    for (const exam of region.exams) {
      index.set(exam.key, { level: 'exam', node: exam, ancestors: [file, region] });
      for (const program of exam.programs) {
        index.set(program.key, { level: 'program', node: program, ancestors: [file, region, exam] });
        for (const step of displaySteps(program.body)) {
          index.set(step.key, { level: 'step', node: step, ancestors: [file, region, exam, program] });
        }
      }
    }
  }
  indexes.set(file, index);
  return index;
}

/**
 * The node with `key` (a file id or a region, exam, program or step key) and its ancestors.
 * The file is found by the key's prefix.
 * @param {Workspace} ws
 * @param {string} key
 * @returns {Located | undefined}
 */
export function lookup(ws, key) {
  const colon = key.indexOf(':');
  const file = fileById(ws, colon < 0 ? key : key.slice(0, colon));
  return file ? indexOf(file).get(key) : undefined;
}

/**
 * Labels from the region down to the node itself (empty for a file).
 * @param {Located} loc
 * @returns {string[]}
 */
export function labelPath(loc) {
  return [...loc.ancestors, loc.node].flatMap((n) => ('label' in n ? [n.label] : []));
}

/**
 * A program's own problems followed by those of its steps.
 * @param {Program} program
 * @returns {Problem[]}
 */
export function programProblems(program) {
  return [...program.problems, ...displaySteps(program.body).flatMap((s) => s.problems)];
}

/**
 * Every problem of a file (the file's, then each program's in tree order), with `where`
 * turned into a label path when it is the key of a node of the file.
 * @param {Workspace} ws
 * @param {ExarFile} file
 * @returns {Problem[]}
 */
export function fileProblems(ws, file) {
  const programs = file.regions.flatMap((r) => r.exams.flatMap((e) => e.programs));
  return [...file.problems, ...programs.flatMap(programProblems)].map((p) => {
    const loc = lookup(ws, p.where);
    if (!loc || loc.level === 'file') return p;
    return { ...p, where: labelPath(loc).join(' › ') };
  });
}

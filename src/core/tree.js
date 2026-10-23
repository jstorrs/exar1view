// @ts-check
/**
 * The directory tree: walk the single EdfStructure document, then fold it into
 * Region > Exam > Program. Pure. Directories are keyed by ObjectId, programs by element id.
 *
 * An exar1 is Root > "New Tree" > region > exam > program. Real files follow that, but the
 * fold also copes with any other depth: nothing is dropped, odd placements get a warning.
 */
import { commentOf, docBody, labelOf } from './docs.js';
import { FormatError } from './errors.js';
import { obj, str } from './json.js';
import { buildProgram, childIndex } from './program.js';

/** @typedef {import('./head.js').InstanceRow} InstanceRow */
/** @typedef {import('./docs.js').DocResult} DocResult */
/** @typedef {import('./model.js').Problem} Problem */
/** @typedef {import('./model.js').Region} Region */
/** @typedef {import('./model.js').Exam} Exam */
/** @typedef {import('./model.js').Program} Program */

/**
 * @typedef {object} HeadData
 * @property {string} fileId
 * @property {ReadonlyMap<string, InstanceRow>} instances by element id
 * @property {ReadonlyMap<string, DocResult>} docs by content hash
 */

/**
 * A walked directory.
 * @typedef {object} Node
 * @property {string} oid
 * @property {string} label
 * @property {string | null} comment
 * @property {string[]} path labels from Root to this directory
 * @property {Node[]} dirs
 * @property {InstanceRow[]} programs
 */

const SEP = ' › ';

/**
 * One of the structure's directory -> id list maps. A missing map or a malformed list is a
 * warning and that part is treated as empty.
 * @param {Record<string, import('./json.js').Json>} body
 * @param {string} name
 * @param {string} ctx
 * @param {(where: string, message: string) => void} warn
 * @returns {Map<string, string[]>}
 */
function idLists(body, name, ctx, warn) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  /** @type {Record<string, import('./json.js').Json>} */
  let lists;
  try {
    lists = obj(body, name, ctx);
  } catch (err) {
    if (!(err instanceof FormatError)) throw err;
    warn(ctx, `${name} is unusable: ${err.message}`);
    return out;
  }
  for (const [key, list] of Object.entries(lists)) {
    if (Array.isArray(list) && list.every((v) => typeof v === 'string')) {
      out.set(key, /** @type {string[]} */ (list));
    } else {
      warn(`directory ${key}`, `${name} entry is not a list of ids; skipped`);
    }
  }
  return out;
}

/**
 * Walk the structure document into nested directory nodes.
 * @param {HeadData} head
 * @param {Problem[]} problems file-level problems are added here
 * @returns {{ root: Node, unplaced: InstanceRow[] }} unplaced: programs the walk never reached
 */
function walkStructure(head, problems) {
  const { instances, docs } = head;
  const structures = [...instances.values()].filter((r) => r.type === 'EdfStructure');
  if (structures.length !== 1) {
    throw new FormatError(`expected exactly one EdfStructure, found ${structures.length}`);
  }
  const ctx = `structure ${structures[0].element}`;
  const body = docBody(structures[0], docs);
  const rootId = str(body, 'RootDirectoryId', ctx);
  /** @param {string} where @param {string} message @param {Problem['level']} [level] */
  const warn = (where, message, level = 'warning') => problems.push({ level, where, message });
  const subdirs = idLists(body, 'SubdirectoryIds', ctx, warn);
  const subprograms = idLists(body, 'SubprogramElementIds', ctx, warn);
  /** @type {Map<string, InstanceRow>} */
  const dirRows = new Map();
  for (const row of instances.values()) {
    if (row.type !== 'EdfDirectory') continue;
    if (dirRows.has(row.object)) {
      problems.push({ level: 'warning', where: `directory ${row.object}`, message: 'another directory has the same ObjectId; skipped' });
    } else {
      dirRows.set(row.object, row);
    }
  }

  /** @type {Set<string>} */
  const seen = new Set();

  /**
   * @param {string} oid
   * @param {string[]} parentPath
   * @returns {Node | null}
   */
  const visit = (oid, parentPath) => {
    const where = `directory ${oid}`;
    if (seen.has(oid)) {
      warn(where, 'reached more than once; skipped');
      return null;
    }
    seen.add(oid);
    const row = dirRows.get(oid);
    if (row === undefined) {
      warn(where, 'listed in the structure but not in the head; skipped');
      return null;
    }
    try {
      docBody(row, docs);
    } catch (err) {
      if (!(err instanceof FormatError)) throw err;
      warn(where, err.message, 'error');
    }
    const label = labelOf(row, instances, docs, (m) => warn(where, m));
    const path = [...parentPath, label];
    /** @type {Node} */
    const node = {
      oid, label, path, dirs: [], programs: [],
      comment: commentOf(row, instances, docs, (m) => warn(where, m)),
    };
    for (const sub of subdirs.get(oid) ?? []) {
      const child = visit(sub, path);
      if (child) node.dirs.push(child);
    }
    for (const element of subprograms.get(oid) ?? []) {
      const program = instances.get(element);
      if (program === undefined || program.type !== 'EdfProgram') {
        warn(where, `program ${element} is not an EdfProgram in the head; skipped`);
      } else if (seen.has(element)) {
        warn(where, `program ${element} is listed more than once; skipped`);
      } else {
        seen.add(element);
        node.programs.push(program);
      }
    }
    return node;
  };

  const root = visit(rootId, []);
  if (root === null) throw new FormatError(`${ctx}: root directory ${rootId} is not in the head`);
  for (const oid of dirRows.keys()) {
    if (!seen.has(oid)) warn(`directory ${oid}`, 'not reachable from the root; skipped');
  }
  const unplaced = [...instances.values()].filter((r) => r.type === 'EdfProgram' && !seen.has(r.element));
  for (const row of unplaced) warn(`program ${row.element}`, 'not reachable from the root; shown under "(unplaced programs)"');
  return { root, unplaced };
}

/**
 * Fold the walked directories into regions. Regions are the grandchildren of the root
 * (Root > New Tree > region); if the root does not have exactly one child they are its children.
 * @param {Node} root
 * @param {InstanceRow[]} unplaced programs the walk never reached
 * @param {HeadData} head
 * @param {Problem[]} problems
 * @returns {Region[]}
 */
function foldRegions(root, unplaced, head, problems) {
  const { fileId } = head;
  const children = childIndex(head.instances.values());
  /** @param {InstanceRow} row @param {string[]} dirPath */
  const program = (row, dirPath) => buildProgram(row, { head, children, dirPath });
  const regionDepth = root.dirs.length === 1 ? 2 : 1;
  if (root.dirs.length !== 1) {
    problems.push({
      level: 'warning', where: `directory ${root.oid}`,
      message: `the root has ${root.dirs.length} child directories, expected 1 (New Tree); treating them as regions`,
    });
  }

  /** @param {Node} node @param {string} message */
  const oddPlacement = (node, message) => problems.push({
    level: 'warning', where: `directory ${node.oid}`, message: `${node.path.join(SEP)}: ${message}`,
  });

  /**
   * @param {string} key
   * @param {string} label
   * @param {string | null} comment
   * @param {Program[]} programs
   * @returns {Exam}
   */
  const exam = (key, label, comment, programs) => ({ key, label, comment, programs });

  /**
   * Everything under an exam directory, programs first: deeper directories give theirs up.
   * @param {Node} node
   * @param {string} regionLabel
   * @returns {Exam}
   */
  const buildExam = (node, regionLabel) => {
    /** @type {Program[]} */
    const programs = [];
    /** @param {Node} n @param {string[]} dirPath */
    const collect = (n, dirPath) => {
      if (n !== node && n.programs.length) {
        oddPlacement(n, `directory below exam level; its programs are shown in exam "${node.label}"`);
      }
      for (const row of n.programs) programs.push(program(row, [regionLabel, ...dirPath]));
      for (const child of n.dirs) collect(child, [...dirPath, child.label]);
    };
    collect(node, [node.label]);
    return exam(`${fileId}:e:${node.oid}`, node.label, node.comment, programs);
  };

  /**
   * Programs sitting in a directory above exam level get a synthetic exam.
   * @param {Node} node
   * @param {string} regionLabel
   * @returns {Exam}
   */
  const directExam = (node, regionLabel) => {
    oddPlacement(node, 'programs outside an exam are shown in a synthetic exam');
    const label = `(programs directly in ${node.label})`;
    return exam(`${fileId}:e:${node.oid}`, label, null,
      node.programs.map((row) => program(row, [regionLabel, label])));
  };

  /** @param {Node} node @returns {Region} */
  const buildRegion = (node) => {
    const exams = node.dirs.map((child) => buildExam(child, node.label));
    if (node.programs.length) exams.push(directExam(node, node.label));
    return { key: `${fileId}:r:${node.oid}`, label: node.label, comment: node.comment, exams };
  };

  /** @type {Region[]} */
  const regions = [];
  /** @param {Node} node @param {number} depth */
  const descend = (node, depth) => {
    if (depth === regionDepth) {
      regions.push(buildRegion(node));
      return;
    }
    if (node.programs.length) {
      const label = `(programs directly in ${node.label})`;
      oddPlacement(node, 'programs outside a region are shown in a synthetic region');
      regions.push({
        key: `${fileId}:r:${node.oid}`, label, comment: null,
        exams: [exam(`${fileId}:e:${node.oid}`, label, null,
          node.programs.map((row) => program(row, [label])))],
      });
    }
    for (const child of node.dirs) descend(child, depth + 1);
  };
  descend(root, 0);
  if (unplaced.length) {
    const label = '(unplaced programs)';
    regions.push({
      key: `${fileId}:r:unplaced`, label, comment: null,
      exams: [exam(`${fileId}:e:unplaced`, label, null, unplaced.map((row) => program(row, [label])))],
    });
  }
  return regions;
}

/**
 * Build the Region > Exam > Program tree of a resolved head.
 * Throws a FormatError when there is no usable structure document.
 * @param {HeadData} head
 * @returns {{ regions: Region[], problems: Problem[] }}
 */
export function buildRegions(head) {
  /** @type {Problem[]} */
  const problems = [];
  const { root, unplaced } = walkStructure(head, problems);
  return { regions: foldRegions(root, unplaced, head, problems), problems };
}

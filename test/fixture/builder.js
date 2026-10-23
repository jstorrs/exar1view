// @ts-check
/**
 * Builds a synthetic exar1 in memory, shaped like a real export: two Branch rows, a change set
 * chain ending in the head, base and delta element maps, old instance versions the head does
 * not map, and Json.NET-style content documents. Test code only; Node APIs.
 */
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { loadSql } from '../sqljs.js';
import { defaultSpec } from './spec.js';

/** @typedef {import('./spec.js').ExarSpec} ExarSpec */
/** @typedef {import('./spec.js').DirSpec} DirSpec */
/** @typedef {import('./spec.js').Label} Label */

const SQL = await loadSql();

const NIL = '00000000-0000-0000-0000-000000000000';

const DDL = [
  'create table ElementToInstanceMap (Id UNIQUEIDENTIFIER not null, Data BLOB not null, primary key (Id))',
  'create table InstanceChangeSet (InstanceId UNIQUEIDENTIFIER not null, ChangeSetId UNIQUEIDENTIFIER not null, ElementId UNIQUEIDENTIFIER not null, State INTEGER not null, primary key (ElementId, ChangeSetId))',
  'create table Instance (Id UNIQUEIDENTIFIER not null, Element_id UNIQUEIDENTIFIER not null, ContentHash TEXT, Children BLOB, Tags TEXT, ParentElementId UNIQUEIDENTIFIER, LabelElement_id UNIQUEIDENTIFIER, DescriptionElement_id UNIQUEIDENTIFIER, InstanceType TEXT, ObjectId UNIQUEIDENTIFIER not null, primary key (Id))',
  'create table Content (Hash TEXT not null, Data BLOB not null, Format TEXT not null, primary key (Hash))',
  'create table Element (Id UNIQUEIDENTIFIER not null, Type INTEGER not null, CommentElement_id UNIQUEIDENTIFIER, primary key (Id))',
  'create table ChangeSet (Id UNIQUEIDENTIFIER not null, Author TEXT not null, DateTime DATETIME not null, Comment TEXT not null, MachineName TEXT not null, Parent1ChangeSet_id UNIQUEIDENTIFIER, Parent2ChangeSet_id UNIQUEIDENTIFIER, BaseElementMapId UNIQUEIDENTIFIER not null, DeltaElementMapId UNIQUEIDENTIFIER not null, primary key (Id))',
  'create table Branch (Baseline TEXT not null, Name TEXT not null, Head UNIQUEIDENTIFIER not null, primary key (Baseline, Name))',
];

/** @param {string} ns one hex digit @param {number} n */
const guid = (ns, n) => `${ns.repeat(8)}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** A GUID in .NET byte order, the inverse of `guidFromBytesLe`. @param {string} g */
function guidBytesLe(g) {
  const b = Buffer.from(g.replaceAll('-', ''), 'hex');
  return Buffer.concat([Buffer.from(b.subarray(0, 4)).reverse(), Buffer.from(b.subarray(4, 6)).reverse(),
    Buffer.from(b.subarray(6, 8)).reverse(), b.subarray(8)]);
}

/** @param {[string, string][]} pairs element, instance @returns {Uint8Array} */
const mapBlob = (pairs) => new Uint8Array(Buffer.concat(pairs.flatMap(([e, i]) => [guidBytesLe(e), guidBytesLe(i)])));

/**
 * A Json.NET document writer: `$id` on every object, `$values` around arrays.
 */
function jsonNet() {
  let n = 0;
  /** @param {Record<string, unknown>} fields */
  const obj = (fields) => ({ $id: String(++n), ...fields });
  /** @param {unknown[]} items */
  const values = (items) => ({ $id: String(++n), $values: items });
  return { obj, values };
}

/**
 * Content row for a document: raw DEFLATE of the EDF header line plus JSON; hash is the SHA-1
 * of the inflated bytes.
 * @param {string} contentType e.g. EdfStringContent
 * @param {object} body
 * @returns {{ hash: string, data: Uint8Array }}
 */
function edfBlob(contentType, body) {
  const raw = Buffer.from(
    `EDF V1: ContentType=syngo.MR.ExamDataFoundation.Data.${contentType};\r\n${JSON.stringify(body, null, 2)}`);
  return { hash: createHash('sha1').update(raw).digest('hex'), data: new Uint8Array(deflateRawSync(raw)) };
}

/** @param {Label} label @returns {Record<string, string>} */
const texts = (label) => (typeof label === 'string' ? { en: label } : label);

/** @param {Record<string, string> | undefined} tags */
const tagString = (tags) => Object.entries(tags ?? {}).map(([k, v]) => `#${k}|${v}`).join('');

/**
 * @param {ExarSpec} spec
 * @returns {Uint8Array}
 */
export function buildExar(spec = defaultSpec) {
  /** @type {Map<string, Uint8Array>} */
  const contents = new Map();
  /** @type {unknown[][]} */
  const instanceRows = [];
  /** @type {string[]} */
  const elements = [];
  /** @type {[string, string][]} element -> instance of the final tree */
  const finalMap = [];
  const counters = { e: 0, i: 0, o: 0 };
  const next = (/** @type {'e' | 'i' | 'o'} */ k) => ++counters[k];

  /**
   * @param {{ type: string, element?: string, body: object, tags?: string, parent?: string | null,
   *   label?: string | null, description?: string | null, object?: string }} a
   */
  function addInstance(a) {
    const element = a.element ?? guid('e', next('e'));
    const instance = guid('1', next('i'));
    const object = a.object ?? guid('b', next('o'));
    const blob = edfBlob(`${a.type}Content`, a.body);
    contents.set(blob.hash, blob.data);
    instanceRows.push([instance, element, blob.hash, null, a.tags ?? '', a.parent ?? null,
      a.label ?? null, a.description ?? null, a.type, object]);
    if (!elements.includes(element)) elements.push(element);
    return { element, instance, object };
  }

  /** @param {Label} label @param {string} parent @returns {string} the string's element id */
  function addString(label, parent) {
    const j = jsonNet();
    const { element, instance } = addInstance({
      type: 'EdfString', parent,
      body: j.obj({ Dates: j.obj({}), Texts: j.obj(texts(label)) }),
    });
    finalMap.push([element, instance]);
    return element;
  }

  const DATA = 'syngo.MR.ExamDataFoundation.Data';

  /**
   * A program document with one link and one relation between two step ObjectIds (distinct per
   * program, so every program has its own Content row). The "To" maps hold Json.NET `$ref`s to the
   * "From" entries, as real files do. The steps themselves are not in the fixture yet.
   * @param {ReturnType<typeof jsonNet>} j
   * @param {number} n
   */
  function programBody(j, n) {
    const first = guid('f', 2 * n);
    const last = guid('f', 2 * n + 1);
    const link = j.obj({ $type: `${DATA}.EdfProgramLink, ${DATA}`, ConditionId: NIL, SelectionId: NIL, SourceId: first, TargetId: last });
    const relation = j.obj({ $type: `${DATA}.EdfProgramRelation, ${DATA}`, Kind: 'CopyReference', SourceId: first, TargetId: last, Data: '', State: 0, Constraint: '' });
    const from = (/** @type {string} */ key, /** @type {object} */ item) => j.obj({ [key]: j.values([item]) });
    return j.obj({
      BodyPartExamined: '', Conditions: j.obj({}), FirstStepId: first, LastStepId: last, Laterality: '',
      LinksFrom: from(first, link), LinksTo: from(last, { $ref: link.$id }),
      Ranks: j.obj({ [first]: j.obj({ Rank: 0, StepId: first }), [last]: j.obj({ Rank: 1, StepId: last }) }),
      RelationsFrom: from(first, relation), RelationsTo: from(last, { $ref: relation.$id }),
    });
  }

  const structure = {
    /** @type {Record<string, string>} */ parents: {},
    /** @type {Record<string, string[]>} */ subdirs: {},
    /** @type {Record<string, string[]>} */ subprograms: {},
    /** @type {string[]} */ programs: [],
  };

  // The structure element is the root directory's parent, as in real files.
  const structureElement = guid('e', next('e'));
  let programCount = 0;

  /** @param {DirSpec} dir @param {string} parentOid @param {string} parentElement */
  function addDirectory(dir, parentOid, parentElement) {
    const element = guid('e', next('e'));
    const object = guid('b', next('o'));
    const j = jsonNet();
    const label = addString(dir.label, element);
    const description = dir.comment === undefined ? null : addString(dir.comment, element);
    const added = addInstance({
      type: 'EdfDirectory', element, object, label, description, parent: parentElement,
      body: j.obj({ BodyPartExamined: '', IsProtected: dir.isProtected ?? false, Laterality: '', Password: dir.password ?? '' }),
    });
    finalMap.push([element, added.instance]);
    structure.parents[object] = parentOid;
    structure.subdirs[object] = (dir.dirs ?? []).map((d) => addDirectory(d, object, element));
    structure.subprograms[object] = (dir.programs ?? []).map((p) => {
      const pj = jsonNet();
      const pElement = guid('e', next('e'));
      const pLabel = addString(p.label, pElement);
      const pDescription = p.comment === undefined ? null : addString(p.comment, pElement);
      const prog = addInstance({
        type: 'EdfProgram', element: pElement, label: pLabel, description: pDescription, tags: tagString(p.tags),
        parent: element, body: programBody(pj, ++programCount),
      });
      finalMap.push([pElement, prog.instance]);
      structure.parents[pElement] = object;
      structure.programs.push(pElement);
      return pElement;
    });
    return object;
  }

  const rootOid = addDirectory(spec.root, NIL, structureElement);
  structure.parents[rootOid] = NIL;

  /** @param {boolean} old */
  const structureBody = (old) => {
    const j = jsonNet();
    const lists = (/** @type {Record<string, string[]>} */ m) =>
      j.obj(Object.fromEntries(Object.entries(old ? { [rootOid]: [] } : m).map(([k, v]) => [k, j.values(v)])));
    return j.obj({
      ParentDirectoryId: j.obj(old ? { [rootOid]: NIL } : structure.parents),
      ProgramElementIds: j.values(old ? [] : structure.programs),
      RootDirectoryId: rootOid,
      SubdirectoryIds: lists(structure.subdirs),
      SubprogramElementIds: lists(structure.subprograms),
    });
  };
  // The structure element has an old version (empty tree) that the delta map replaces.
  const structureObject = guid('b', next('o'));
  const oldStructure = addInstance({ type: 'EdfStructure', element: structureElement, object: structureObject, body: structureBody(true) });
  const newStructure = addInstance({ type: 'EdfStructure', element: structureElement, object: structureObject, body: structureBody(false) });

  // An element that the delta removes again.
  const j = jsonNet();
  const gone = addInstance({ type: 'EdfString', body: j.obj({ Dates: j.obj({}), Texts: j.obj({ en: 'Removed text' }) }) });

  const maps = { a: guid('d', 1), b: guid('d', 2), delta: guid('d', 3) };
  const mapRows = [
    [maps.a, mapBlob([[structureElement, oldStructure.instance]])],
    [maps.b, mapBlob([...finalMap, [structureElement, oldStructure.instance], [gone.element, gone.instance]])],
    [maps.delta, mapBlob([[structureElement, newStructure.instance], [gone.element, NIL]])],
  ];

  const cs = [guid('c', 1), guid('c', 2), guid('c', 3)];
  const changesets = [
    [cs[0], 'tester', '2025-01-01 10:00:00.0000000', 'initial creation', 'TESTPC', null, null, NIL, NIL],
    [cs[1], 'tester', '2025-01-01 10:00:01.2500000', 'Export CreateTree New Tree', 'TESTPC', cs[0], null, maps.a, NIL],
    [cs[2], 'tester', '2025-01-01 10:00:05.5000000', 'Save by CopyProgramsPipeline', 'TESTPC', cs[1], null, maps.b, maps.delta],
  ];

  const db = new SQL.Database();
  try {
    for (const sql of DDL) db.run(sql);
    /** @param {string} table @param {unknown[][]} rows */
    const insert = (table, rows) => {
      for (const row of rows) db.run(`insert into ${table} values (${row.map(() => '?').join(',')})`, /** @type {any[]} */ (row));
    };
    insert('Branch', [['-', 'Latest', cs[0]], [spec.baseline, 'Latest', cs[2]]]);
    insert('ChangeSet', changesets);
    insert('ElementToInstanceMap', mapRows);
    insert('Element', elements.map((e) => [e, 1, null]));
    // Instance columns in table order: Id, Element_id, ContentHash, Children, Tags, ParentElementId,
    // LabelElement_id, DescriptionElement_id, InstanceType, ObjectId
    insert('Instance', instanceRows);
    insert('Content', [...contents].map(([hash, data]) => [hash, data, 'DS']));
    return db.export();
  } finally {
    db.close();
  }
}

/**
 * A copy of `bytes` after running SQL statements on it, to damage a fixture on purpose.
 * @param {Uint8Array} bytes
 * @param {...string} statements
 * @returns {Uint8Array}
 */
export function editExar(bytes, ...statements) {
  const db = new SQL.Database(bytes);
  try {
    for (const sql of statements) db.run(sql);
    return db.export();
  } finally {
    db.close();
  }
}

// @ts-check
/**
 * Resolve an exar1's head: check the schema, pick the head change set, resolve its element
 * map and read the mapped instances. Pure over the `Db` port. Fatal problems throw a
 * FormatError; recoverable ones come back as warnings and the offending row is skipped.
 */
import { INSTANCE_TYPES, parseTags } from './edf.js';
import { FormatError } from './errors.js';
import { optGuid } from './guid.js';
import { applyMaps, decodeMap } from './maps.js';

/** @typedef {import('../platform/sqlite.js').Db} Db */
/** @typedef {import('./model.js').Problem} Problem */
/** @typedef {import('./edf.js').InstanceType} InstanceType */

/**
 * One mapped `Instance` row, parsed.
 * @typedef {object} InstanceRow
 * @property {string} id
 * @property {string} element
 * @property {string} object
 * @property {InstanceType} type
 * @property {string} contentHash
 * @property {Record<string, string>} tags
 * @property {string | null} parent element id
 * @property {string | null} label element id of the EdfString
 * @property {string | null} description element id of the EdfString
 */

/**
 * @typedef {object} Head
 * @property {string} baseline
 * @property {{ id: string, dateTime: string, comment: string }} changeset
 * @property {Map<string, InstanceRow>} instances by element id
 * @property {Problem[]} problems
 */

/** Required columns per table; the tool never reads anything else. */
export const EXPECTED_SCHEMA = /** @type {const} */ ({
  Branch: ['Baseline', 'Name', 'Head'],
  ChangeSet: ['Id', 'Author', 'DateTime', 'Comment', 'MachineName', 'Parent1ChangeSet_id',
    'Parent2ChangeSet_id', 'BaseElementMapId', 'DeltaElementMapId'],
  ElementToInstanceMap: ['Id', 'Data'],
  Element: ['Id', 'Type', 'CommentElement_id'],
  Instance: ['Id', 'Element_id', 'ContentHash', 'Children', 'Tags', 'ParentElementId',
    'LabelElement_id', 'DescriptionElement_id', 'InstanceType', 'ObjectId'],
  InstanceChangeSet: ['InstanceId', 'ChangeSetId', 'ElementId', 'State'],
  Content: ['Hash', 'Data', 'Format'],
});

const ALLOWED_EXTRA_TABLES = new Set(['SlimInfo']);
const EXPORT_BASELINE_PLACEHOLDER = '-';
const INSTANCE_TYPE_SET = new Set(/** @type {readonly string[]} */ (INSTANCE_TYPES));

/** @param {unknown} v @param {string} ctx @returns {string} */
function text(v, ctx) {
  if (typeof v !== 'string') throw new FormatError(`${ctx}: expected text`);
  return v;
}

/**
 * Fail unless every required table has its required columns; other tables are warnings.
 * @param {Db} db
 * @returns {Problem[]}
 */
export function checkSchema(db) {
  const names = db.rows("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    .map(([n]) => String(n));
  /** @type {Problem[]} */
  const problems = [];
  for (const [table, columns] of Object.entries(EXPECTED_SCHEMA)) {
    if (!names.includes(table)) throw new FormatError(`not an exar1 export: table ${table} is missing`);
    const have = new Set(db.rows('select name from pragma_table_info(?)', [table]).map(([c]) => String(c)));
    const missing = columns.filter((c) => !have.has(c));
    if (missing.length) {
      throw new FormatError(`not an exar1 export: table ${table} lacks column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`);
    }
  }
  for (const name of names) {
    if (name in EXPECTED_SCHEMA || ALLOWED_EXTRA_TABLES.has(name)) continue;
    problems.push({ level: 'warning', where: 'file', message: `unexpected table ${name}` });
  }
  return problems;
}

/**
 * The element map blob `id` as pairs; a NULL or nil id is an empty map.
 * @param {Db} db
 * @param {string | null} id
 * @param {string} what "base" or "delta"
 * @returns {[string, string | null][]}
 */
function readMap(db, id, what) {
  if (id === null) return [];
  const rows = db.rows('select Data from ElementToInstanceMap where Id = ?', [id]);
  if (rows.length === 0) throw new FormatError(`${what} element map ${id} is missing`);
  const data = rows[0][0];
  if (!(data instanceof Uint8Array)) throw new FormatError(`${what} element map ${id} is not a blob`);
  try {
    return decodeMap(data);
  } catch (err) {
    if (err instanceof FormatError) throw new FormatError(`${what} element map ${id}: ${err.message}`);
    throw err;
  }
}

/**
 * The export's one real branch, its head change set, and the resolved element map.
 * @param {Db} db
 * @returns {{ baseline: string, changeset: Head['changeset'], map: Map<string, string>, problems: Problem[] }}
 */
export function pickHead(db) {
  const branches = db.rows('select Baseline, Name, Head from Branch');
  const real = branches.filter(([baseline]) => baseline !== EXPORT_BASELINE_PLACEHOLDER);
  if (real.length > 1) {
    throw new FormatError(`not an exar1 export: found ${real.length} branches; this looks like a main database (exdb1)`);
  }
  if (real.length === 0) throw new FormatError("not an exar1 export: no branch other than '-'");
  const baseline = text(real[0][0], 'Branch.Baseline');
  const headId = optGuid(/** @type {string | null} */ (real[0][2]), 'Branch.Head');
  if (headId === null) throw new FormatError(`branch ${baseline}: no head change set`);

  const rows = db.rows(
    'select Id, DateTime, Comment, BaseElementMapId, DeltaElementMapId from ChangeSet where Id = ?', [headId]);
  if (rows.length === 0) throw new FormatError(`head change set ${headId} is missing`);
  const [, dateTime, comment, baseId, deltaId] = rows[0];
  const ctx = `change set ${headId}`;
  const changeset = {
    id: headId,
    dateTime: text(dateTime, `${ctx} DateTime`),
    comment: comment === null ? '' : text(comment, `${ctx} Comment`),
  };

  /** @type {Problem[]} */
  const problems = [];
  const children = db.rows(
    'select 1 from ChangeSet where Parent1ChangeSet_id = ? or Parent2ChangeSet_id = ? limit 1', [headId, headId]);
  if (children.length) {
    problems.push({ level: 'warning', where: 'file', message: `head change set ${headId} has child change sets` });
  }

  const base = readMap(db, optGuid(/** @type {string | null} */ (baseId), `${ctx} BaseElementMapId`), 'base');
  const delta = readMap(db, optGuid(/** @type {string | null} */ (deltaId), `${ctx} DeltaElementMapId`), 'delta');
  return { baseline, changeset, map: applyMaps(base, delta), problems };
}

/**
 * Parse one Instance row. Throws a FormatError for a row that cannot be used;
 * bad tags are not fatal, they are reported through `warn` and left empty.
 * @param {unknown[]} row Id, Element_id, ContentHash, Tags, ParentElementId, LabelElement_id,
 *   DescriptionElement_id, InstanceType, ObjectId
 * @param {(message: string) => void} warn
 * @returns {InstanceRow}
 */
function parseInstanceRow(row, warn) {
  const [id, element, contentHash, tags, parent, label, description, type, object] =
    /** @type {(string | null)[]} */ (row);
  /** @param {string | null} v @param {string} col */
  const required = (v, col) => {
    const g = optGuid(v, `Instance.${col}`);
    if (g === null) throw new FormatError(`${col} is empty`);
    return g;
  };
  const type_ = text(type, 'InstanceType');
  if (!INSTANCE_TYPE_SET.has(type_)) throw new FormatError(`unknown InstanceType ${JSON.stringify(type_)}`);
  /** @type {Record<string, string>} */
  let parsedTags = {};
  try {
    parsedTags = parseTags(tags);
  } catch (err) {
    if (!(err instanceof FormatError)) throw err;
    warn('malformed tags ignored');
  }
  return {
    id: required(id, 'Id'),
    element: required(element, 'Element_id'),
    object: required(object, 'ObjectId'),
    type: /** @type {InstanceType} */ (type_),
    contentHash: text(contentHash, 'ContentHash'),
    tags: parsedTags,
    parent: optGuid(parent, 'Instance.ParentElementId'),
    label: optGuid(label, 'Instance.LabelElement_id'),
    description: optGuid(description, 'Instance.DescriptionElement_id'),
  };
}

/**
 * Resolve the head of an exar1: the instances its element map points at, by element id.
 * The Instance table also holds old versions, so it is scanned once and filtered by id.
 * @param {Db} db
 * @returns {Head}
 */
export function loadHead(db) {
  const { baseline, changeset, map, problems } = pickHead(db);
  const wanted = new Set(map.values());
  /** @type {Map<string, unknown[]>} raw rows of the mapped instances, by instance id */
  const found = new Map();
  const scan = db.rows(
    'select Id, Element_id, ContentHash, Tags, ParentElementId, LabelElement_id, DescriptionElement_id, InstanceType, ObjectId from Instance');
  for (const row of scan) {
    if (wanted.has(/** @type {string} */ (row[0]))) found.set(/** @type {string} */ (row[0]), row);
  }

  /** @param {string} where @param {string} message */
  const warn = (where, message) => problems.push({ level: 'warning', where, message });
  /** @type {Map<string, InstanceRow>} */
  const instances = new Map();
  for (const [element, instance] of map) {
    const where = `element ${element}`;
    const row = found.get(instance);
    if (row === undefined) {
      warn(where, `mapped instance ${instance} is not in the Instance table; skipped`);
      continue;
    }
    try {
      const parsed = parseInstanceRow(row, (m) => warn(where, `instance ${instance}: ${m}`));
      if (parsed.element !== element) {
        warn(where, `instance ${instance} belongs to element ${parsed.element}; skipped`);
        continue;
      }
      instances.set(element, parsed);
    } catch (err) {
      if (!(err instanceof FormatError)) throw err;
      warn(where, `instance ${instance}: ${err.message}; skipped`);
    }
  }
  return { baseline, changeset, instances, problems };
}


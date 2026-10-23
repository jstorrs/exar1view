// @ts-check
/**
 * One program's documents to its body: steps, conditions, the nested Split/Join forks and the
 * copy references. Pure. A lenient port of protocol_tools' edf/program.py: where that reader
 * refuses a program, this one keeps what it can and reports a problem.
 *
 * Steps are the program's child instances (ParentElementId) of the seven step types; condition
 * strings are its child EdfStrings, referenced by ObjectId. Order comes from walking LinksFrom
 * from FirstStepId; when the links, forks or ends do not add up, the steps are shown flat in
 * rank order instead (`order: 'rank'`) with one warning saying why. LinksTo/RelationsTo are
 * mirrors holding Json.NET `$ref`s and are never read.
 */
import { commentOf, docBody, labelOf } from './docs.js';
import { labelText } from './edf.js';
import { FormatError, errorText } from './errors.js';
import { isGuid, optGuid } from './guid.js';
import { arr, asObj, bool, int, obj, optBool, optStr, str } from './json.js';
import { displaySteps } from './model.js';

/** @typedef {import('./json.js').Json} Json */
/** @typedef {import('./head.js').InstanceRow} InstanceRow */
/** @typedef {import('./edf.js').InstanceType} InstanceType */
/** @typedef {import('./tree.js').HeadData} HeadData */
/** @typedef {import('./model.js').Problem} Problem */
/** @typedef {import('./model.js').Program} Program */
/** @typedef {import('./model.js').Step} Step */
/** @typedef {import('./model.js').StepKind} StepKind */
/** @typedef {import('./model.js').BodyNode} BodyNode */
/** @typedef {import('./model.js').Condition} Condition */
/** @typedef {import('./model.js').Choice} Choice */
/** @typedef {import('./model.js').CopyRef} CopyRef */

/** @typedef {(message: string) => void} Report */

/**
 * An out-link; `condition` and `choice` are both set (a split's branch) or both null.
 * @typedef {{ target: string, condition: string | null, choice: string | null }} Link
 */

/** What a condition label or choice shows when its string cannot be resolved. */
export const MISSING_LABEL = '(missing label)';

/** @type {Partial<Record<InstanceType, StepKind>>} */
const STEP_KINDS = {
  EdfMeasurementStep: 'Measurement',
  EdfPauseStep: 'Pause',
  EdfInteractionStep: 'Interaction',
  EdfDecisionStep: 'Decision',
  EdfWorkflowStep: 'Workflow',
  EdfSplitStep: 'Split',
  EdfJoinStep: 'Join',
};

/** Per step kind: [protocol children, min add-ins, max add-ins]. */
/** @type {Record<StepKind, [number, number, number]>} */
const STEP_CHILDREN = {
  Measurement: [1, 0, 1],
  Pause: [0, 0, 0],
  Interaction: [0, 1, 1],
  Decision: [0, 1, 1],
  Workflow: [0, 1, 1],
  Split: [0, 0, 0],
  Join: [0, 0, 0],
};

/** (Kind, IsDecicion [sic], IsStrategy): the only two combinations seen. */
/** @type {Record<string, Condition['kind']>} */
const CONDITION_FLAGS = { '0,false,true': 'Strategy', '1,true,false': 'Decision' };

const SHA1_HEX = /^[0-9a-f]{40}$/;

/** Forks nest at most 4 deep in real files; deeper is treated as a broken graph. */
export const MAX_FORK_DEPTH = 64;

const COPY_REF_NS = 'clr-namespace:syngo.MR.ExamDataFoundation.Data;assembly=syngo.MR.ExamDataFoundation.Data';
const COPY_REF_FLAGS = ['CopyPhaseEncodingDirection', 'CopySteps', 'IgnoreLastStep', 'IgnoreMeasurements'];
/** One empty element (`<E … />` or `<E …></E>`), optionally after an XML declaration. */
const COPY_REF_XML = /^\s*(?:<\?xml[^?]*\?>\s*)?<EdfCopyReferenceParameters((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(?:\/>|>\s*<\/EdfCopyReferenceParameters\s*>)\s*$/;
const XML_ATTR = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
/** @type {Record<string, string>} */
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** @param {string} v */
const xmlText = (v) => v.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => XML_ENTITIES[name]);

/**
 * Instances grouped by parent element id; build once per head.
 * @param {Iterable<InstanceRow>} instances
 * @returns {Map<string, InstanceRow[]>}
 */
export function childIndex(instances) {
  /** @type {Map<string, InstanceRow[]>} */
  const index = new Map();
  for (const row of instances) {
    if (row.parent === null) continue;
    const list = index.get(row.parent);
    if (list) list.push(row);
    else index.set(row.parent, [row]);
  }
  return index;
}

/**
 * `fn()`, or null after reporting why when it throws a FormatError.
 * @template T
 * @param {() => T} fn
 * @param {Report} report
 * @returns {T | null}
 */
function lenient(fn, report) {
  try {
    return fn();
  } catch (err) {
    if (!(err instanceof FormatError)) throw err;
    report(err.message);
    return null;
  }
}

/** A required GUID field; nil gives null. @param {Record<string, Json>} o @param {string} key @param {string} ctx */
const guidField = (o, key, ctx) => optGuid(str(o, key, ctx), `${ctx} ${key}`);

/** Stable JSON text: keys sorted, no whitespace. @param {Json} v @returns {string} */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// --- conditions ----------------------------------------------------------------------------------

/**
 * The display text of the program's child string `oid`; errors are prefixed with `ctx`.
 * @param {string} oid
 * @param {ReadonlyMap<string, InstanceRow>} strings program child strings by ObjectId
 * @param {HeadData['docs']} docs
 * @param {string} ctx
 */
function stringByObject(oid, strings, docs, ctx) {
  const row = strings.get(oid);
  if (row === undefined) throw new FormatError(`${ctx}: string ${oid} is not a child of the program`);
  try {
    return labelText(docBody(row, docs));
  } catch (err) {
    if (err instanceof FormatError) throw new FormatError(`${ctx}: ${err.message}`);
    throw err;
  }
}

/** The ObjectId of a `{FullName, ObjectId}` string reference; nil gives null. @param {Json} raw @param {string} ctx */
const stringRef = (raw, ctx) => guidField(asObj(raw, ctx), 'ObjectId', ctx);

/**
 * One `Conditions` entry. Unknown flags make it 'Other'; an unresolvable label or choice shows
 * MISSING_LABEL; a Description that does not resolve is absent (real files have dangling ones).
 * @param {string} id
 * @param {Json} raw
 * @param {ReadonlyMap<string, InstanceRow>} strings
 * @param {HeadData['docs']} docs
 * @param {Report} warn
 * @returns {Condition}
 */
function readCondition(id, raw, strings, docs, warn) {
  const ctx = `condition ${id}`;
  const c = asObj(raw, ctx);
  if (c.Id !== id) warn(`${ctx}: Id is missing or differs from its key`);
  const flags = lenient(() => [int(c, 'Kind', ctx), bool(c, 'IsDecicion', ctx), bool(c, 'IsStrategy', ctx)].join(), warn);
  const kind = flags === null ? undefined : CONDITION_FLAGS[flags];
  if (flags !== null && kind === undefined) warn(`${ctx}: unknown (Kind, IsDecicion, IsStrategy) combination`);

  /** The text of string `oid`, or MISSING_LABEL after a warning. @param {string} oid @param {string} where */
  const text = (oid, where) => lenient(() => stringByObject(oid, strings, docs, where), warn) ?? MISSING_LABEL;

  let label = MISSING_LABEL;
  try {
    const oid = stringRef(c.Label ?? null, `${ctx} Label`);
    if (oid === null) warn(`${ctx} Label: nil string reference`);
    else label = text(oid, `${ctx} Label`);
  } catch (err) {
    if (!(err instanceof FormatError)) throw err;
    warn(err.message);
  }

  /** @type {Choice[]} */
  const choices = [];
  const seen = new Set();
  arr(c, 'Choices', ctx).forEach((ref, i) => {
    const where = `${ctx} Choices[${i}]`;
    try {
      const objectId = stringRef(ref, where);
      if (objectId === null) throw new FormatError(`${where}: nil string reference`);
      if (seen.has(objectId)) throw new FormatError(`${where}: duplicate choice ${objectId}`);
      seen.add(objectId);
      choices.push({ objectId, label: text(objectId, where) });
    } catch (err) {
      if (!(err instanceof FormatError)) throw err;
      warn(`${err.message}; skipped`);
    }
  });

  let description = null;
  try {
    const oid = Object.hasOwn(c, 'Description') ? stringRef(c.Description, `${ctx} Description`) : null;
    if (oid !== null && strings.has(oid)) description = stringByObject(oid, strings, docs, `${ctx} Description`) || null;
  } catch (err) {
    if (!(err instanceof FormatError)) throw err;
    warn(err.message);
  }

  let defaultChoice = null;
  try {
    const selection = guidField(c, 'SelectionId', ctx);
    if (selection !== null && seen.has(selection)) defaultChoice = selection;
    else warn(`${ctx}: SelectionId is not one of the choices`);
  } catch (err) {
    if (!(err instanceof FormatError)) throw err;
    warn(err.message);
  }

  return { id, kind: kind ?? 'Other', label, description, choices, defaultChoice };
}

/**
 * The program's `Conditions`, in file order; an unusable entry is skipped with a warning.
 * @param {Record<string, Json>} doc
 * @param {ReadonlyMap<string, InstanceRow>} strings
 * @param {HeadData['docs']} docs
 * @param {Report} warn
 * @returns {Condition[]}
 */
function readConditions(doc, strings, docs, warn) {
  const raw = lenient(() => obj(doc, 'Conditions', 'program'), warn);
  /** @type {Condition[]} */
  const out = [];
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!isGuid(key)) {
      warn('a Conditions key is not a GUID; skipped');
      continue;
    }
    try {
      if (optGuid(key) === null) throw new FormatError('a Conditions key is nil');
      out.push(readCondition(key, value, strings, docs, warn));
    } catch (err) {
      if (!(err instanceof FormatError)) throw err;
      warn(`${err.message}; skipped`);
    }
  }
  return out;
}

// --- steps ---------------------------------------------------------------------------------------

/**
 * Step ObjectId -> Rank; malformed entries are warnings.
 * @param {Record<string, Json>} doc
 * @param {Report} warn
 * @returns {Map<string, number>}
 */
function readRanks(doc, warn) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const [key, value] of Object.entries(lenient(() => obj(doc, 'Ranks', 'program'), warn) ?? {})) {
    if (!isGuid(key)) {
      warn('a Ranks key is not a GUID; skipped');
      continue;
    }
    lenient(() => {
      const ctx = `Ranks[${key}]`;
      const entry = asObj(value, ctx);
      if (str(entry, 'StepId', ctx) !== key) throw new FormatError(`${ctx}: StepId differs from its key`);
      out.set(key, int(entry, 'Rank', ctx));
    }, warn);
  }
  return out;
}

/**
 * @typedef {object} StepContext
 * @property {HeadData} head
 * @property {ReadonlyMap<string, InstanceRow[]>} children
 * @property {ReadonlyMap<string, number>} ranks
 * @property {ReadonlySet<string>} conditionIds
 */

/**
 * One step. Never throws on bad data: the step keeps its kind (from the InstanceType) and
 * whatever fields could be read; the rest are null and the step carries the problems.
 * @param {InstanceRow} row
 * @param {StepKind} kind
 * @param {StepContext} ctx
 * @returns {Step}
 */
function buildStep(row, kind, { head, children, ranks, conditionIds }) {
  const key = `${head.fileId}:s:${row.element}`;
  /** @type {Problem[]} */
  const problems = [];
  /** @param {Problem['level']} level @returns {Report} */
  const report = (level) => (message) => problems.push({ level, where: key, message });
  const warn = report('warning');

  const protocols = [];
  const addIns = [];
  for (const kid of children.get(row.element) ?? []) {
    if (kid.type === 'EdfProtocol') protocols.push(kid);
    else if (kid.type === 'EdfAddInConfig') addIns.push(kid);
    else if (kid.type !== 'EdfString' || (kid.element !== row.label && kid.element !== row.description)) {
      warn(`unexpected child ${kid.type} ${kid.element}; ignored`);
    }
  }
  const [wantProtocols, minAddIns, maxAddIns] = STEP_CHILDREN[kind];
  if (protocols.length !== wantProtocols || addIns.length < minAddIns || addIns.length > maxAddIns) {
    warn(`${kind} step with ${protocols.length} protocols and ${addIns.length} add-ins`);
  }
  const addInBlob = addIns[0]?.contentHash ?? null;

  /** @type {Record<string, Json>} */
  let b = {};
  let readable = true;
  try {
    b = docBody(row, head.docs);
  } catch (err) {
    if (!(err instanceof FormatError)) throw err;
    report('error')(err.message);
    readable = false;
  }
  const ctx = row.type;
  /** @template T @param {() => T} fn */
  const read = (fn) => lenient(fn, warn);
  const openBeforeStart = () => read(() => optBool(b, 'OpenBeforeStart', ctx));
  const conditionId = () => {
    const id = read(() => optGuid(optStr(b, 'ConditionId', ctx), `${ctx} ConditionId`));
    if (readable && id === null) warn('no ConditionId');
    if (id !== null && !conditionIds.has(id)) warn(`unknown condition ${id}`);
    return id;
  };

  const base = {
    key,
    ids: { element: row.element, instance: row.id, object: row.object },
    label: labelOf(row, head.instances, head.docs, warn),
    comment: commentOf(row, head.instances, head.docs, warn),
    tags: row.tags,
    rank: ranks.get(row.object) ?? null,
    problems,
  };
  switch (kind) {
    case 'Measurement': {
      const protocol = protocols[0];
      /** @type {string | null} */
      let protocolHash = protocol?.tags.ContentHash ?? null;
      if (protocol && (protocolHash === null || !SHA1_HEX.test(protocolHash))) {
        warn(`protocol ${protocol.element}: missing or malformed ContentHash tag`);
        protocolHash = null;
      }
      return {
        ...base, kind,
        detail: {
          protocolBlob: protocol?.contentHash ?? null,
          protocolHash,
          addInBlob,
          bodyPart: read(() => optStr(b, 'BodyPartExamined', ctx)),
          laterality: read(() => (Object.hasOwn(b, 'Laterality') && b.Laterality === null ? '' : optStr(b, 'Laterality', ctx))),
          imageComment: read(() => optStr(b, 'ImageComment', ctx)),
          openBeforeStart: openBeforeStart(),
        },
      };
    }
    case 'Pause':
      return {
        ...base, kind,
        detail: {
          applyContrastAgent: read(() => optBool(b, 'ApplyContrastAgent', ctx)),
          contrastAgentName: read(() => optStr(b, 'ContrastAgentName', ctx)),
          contrastAgent: read(() => (b.ContrastAgent == null ? null : canonical(obj(b, 'ContrastAgent', ctx)))),
        },
      };
    case 'Interaction':
      return { ...base, kind, detail: { addInBlob, openBeforeStart: openBeforeStart() } };
    case 'Decision':
      return { ...base, kind, detail: { conditionId: conditionId(), addInBlob, openBeforeStart: openBeforeStart() } };
    case 'Workflow':
      return { ...base, kind, detail: { addInBlob } };
    case 'Split':
    case 'Join':
      return { ...base, kind, detail: { conditionId: conditionId() } };
  }
}

// --- relations -----------------------------------------------------------------------------------

/**
 * Parse an `EdfCopyReferenceParameters` element: Group and four True/False flags.
 * @param {string} data
 * @returns {{ group: string, flags: Record<string, boolean> }}
 */
function copyRefData(data) {
  const m = COPY_REF_XML.exec(data);
  if (m === null) throw new FormatError('Data is not one empty EdfCopyReferenceParameters element');
  /** @type {Map<string, string>} */
  const attrs = new Map();
  for (const [, name, double, single] of m[1].matchAll(XML_ATTR)) {
    if (attrs.has(name)) throw new FormatError(`Data: duplicate attribute ${name}`);
    attrs.set(name, xmlText(double ?? single));
  }
  if (attrs.get('xmlns') !== COPY_REF_NS) throw new FormatError('Data: unexpected XML namespace');
  const group = attrs.get('Group');
  if (!group) throw new FormatError('Data: no Group');
  /** @type {Record<string, boolean>} */
  const flags = {};
  for (const name of COPY_REF_FLAGS) {
    const v = attrs.get(name);
    if (v !== 'True' && v !== 'False') throw new FormatError(`Data: ${name} must be True or False`);
    flags[name] = v === 'True';
  }
  const extra = [...attrs.keys()].filter((k) => k !== 'xmlns' && k !== 'Group' && !COPY_REF_FLAGS.includes(k));
  if (extra.length) throw new FormatError(`Data: unexpected attributes ${extra.join(', ')}`);
  return { group, flags };
}

/**
 * `RelationsFrom` in file order: SplitJoin pairs and copy references. `Kind = ""` relations
 * (meaning unknown) are skipped; anything malformed is a warning and skipped.
 * @param {Record<string, Json>} doc
 * @param {ReadonlyMap<string, Step>} steps by ObjectId
 * @param {Report} warn
 * @returns {{ pairs: [string, string][], copyRefs: CopyRef[] }}
 */
function readRelations(doc, steps, warn) {
  /** @type {[string, string][]} */
  const pairs = [];
  /** @type {CopyRef[]} */
  const copyRefs = [];
  for (const [key, list] of Object.entries(lenient(() => obj(doc, 'RelationsFrom', 'program'), warn) ?? {})) {
    if (!isGuid(key)) {
      warn('a RelationsFrom key is not a GUID; skipped');
      continue;
    }
    if (!Array.isArray(list)) {
      warn(`RelationsFrom[${key}] is not a list; skipped`);
      continue;
    }
    list.forEach((raw, i) => {
      const ctx = `RelationsFrom[${key}][${i}]`;
      try {
        const rel = asObj(raw, ctx);
        const source = guidField(rel, 'SourceId', ctx);
        if (source !== key) throw new FormatError(`${ctx}: SourceId differs from its key`);
        const target = guidField(rel, 'TargetId', ctx);
        if (target === null) throw new FormatError(`${ctx}: nil TargetId`);
        const kind = str(rel, 'Kind', ctx);
        if (kind === '') return;
        if (kind === 'SplitJoin') {
          pairs.push([source, target]);
          return;
        }
        if (kind !== 'CopyReference') throw new FormatError(`${ctx}: unknown Kind`);
        for (const end of [source, target]) {
          const step = steps.get(end);
          if (step === undefined) throw new FormatError(`${ctx}: copy-reference endpoint ${end} is not a step of this program`);
          if (step.kind !== 'Measurement') throw new FormatError(`${ctx}: copy-reference endpoint ${end} is a ${step.kind}`);
        }
        const state = str(rel, 'State', ctx);
        if (state !== '' && state !== 'Broken') throw new FormatError(`${ctx}: unknown copy-reference State`);
        const data = str(rel, 'Data', ctx);
        /** @type {ReturnType<typeof copyRefData>} */
        let parsed;
        try {
          parsed = copyRefData(data);
        } catch (err) {
          if (err instanceof FormatError) throw new FormatError(`${ctx}: ${err.message}`);
          throw err;
        }
        copyRefs.push({ source, target, ...parsed, broken: state === 'Broken' });
      } catch (err) {
        if (!(err instanceof FormatError)) throw err;
        warn(`${err.message}; skipped`);
      }
    });
  }
  return { pairs, copyRefs };
}

// --- order ---------------------------------------------------------------------------------------

/**
 * `LinksFrom`: out-links by source step. Throws on anything the walk cannot trust.
 * @param {Record<string, Json>} doc
 * @param {ReadonlyMap<string, Step>} steps
 * @returns {Map<string, Link[]>}
 */
function readLinks(doc, steps) {
  /** @type {Map<string, Link[]>} */
  const out = new Map();
  for (const [key, list] of Object.entries(obj(doc, 'LinksFrom', 'program'))) {
    if (!isGuid(key)) throw new FormatError('a LinksFrom key is not a GUID');
    if (!steps.has(key)) throw new FormatError(`LinksFrom key ${key} is not a step of this program`);
    if (!Array.isArray(list)) throw new FormatError(`LinksFrom[${key}] is not a list`);
    out.set(key, list.map((raw, i) => {
      const ctx = `LinksFrom[${key}][${i}]`;
      const link = asObj(raw, ctx);
      if (guidField(link, 'SourceId', ctx) !== key) throw new FormatError(`${ctx}: SourceId differs from its key`);
      const target = guidField(link, 'TargetId', ctx);
      if (target === null || !steps.has(target)) throw new FormatError(`${ctx}: link to unknown step ${target}`);
      const condition = guidField(link, 'ConditionId', ctx);
      const choice = guidField(link, 'SelectionId', ctx);
      if ((condition === null) !== (choice === null)) {
        throw new FormatError(`${ctx}: ConditionId and SelectionId must be both nil or both set`);
      }
      return { target, condition, choice };
    }));
  }
  return out;
}

/**
 * Split -> join from the SplitJoin relations, which record each pair in both directions.
 * @param {[string, string][]} pairs
 * @param {ReadonlyMap<string, Step>} steps
 * @returns {Map<string, string>}
 */
function joinOf(pairs, steps) {
  /** @type {Map<string, string>} */
  const forward = new Map();
  /** @type {Map<string, string>} */
  const backward = new Map();
  for (const [source, target] of pairs) {
    const a = steps.get(source)?.kind;
    const b = steps.get(target)?.kind;
    const ctx = `SplitJoin ${source} -> ${target}`;
    /** @type {[string, string, Map<string, string>]} */
    let pair;
    if (a === 'Split' && b === 'Join') pair = [source, target, forward];
    else if (a === 'Join' && b === 'Split') pair = [target, source, backward];
    else throw new FormatError(`${ctx}: relates a ${a ?? 'non-step'} and a ${b ?? 'non-step'}`);
    const [split, join, side] = pair;
    if (side.has(split)) throw new FormatError(`${ctx}: split ${split} is paired more than once`);
    side.set(split, join);
  }
  if (forward.size !== backward.size || [...forward].some(([s, j]) => backward.get(s) !== j)) {
    throw new FormatError('SplitJoin relations are not recorded in both directions');
  }
  /** @type {Map<string, number>} */
  const pairings = new Map();
  for (const join of forward.values()) pairings.set(join, (pairings.get(join) ?? 0) + 1);
  for (const [oid, step] of steps) {
    if (step.kind === 'Split' && !forward.has(oid)) throw new FormatError(`unpaired split ${oid}`);
    if (step.kind === 'Join' && pairings.get(oid) !== 1) {
      throw new FormatError(`join ${oid} is paired with ${pairings.get(oid) ?? 0} splits`);
    }
  }
  for (const [split, join] of forward) {
    const sc = /** @type {{ detail: { conditionId: string | null } }} */ (steps.get(split)).detail.conditionId;
    const jc = /** @type {{ detail: { conditionId: string | null } }} */ (steps.get(join)).detail.conditionId;
    if (sc !== jc) throw new FormatError(`split ${split} and join ${join} carry different conditions`);
  }
  return forward;
}

/** The step ObjectId a node is left from. @param {BodyNode} node */
const exitOf = (node) => (node.type === 'step' ? node.step : node.join).ids.object;

/**
 * Walk the links from `first` into nested steps and forks, every step exactly once.
 * @param {string} first
 * @param {ReadonlyMap<string, Step>} steps
 * @param {ReadonlyMap<string, Link[]>} links
 * @param {ReadonlyMap<string, string>} joins split -> join
 * @param {ReadonlyMap<string, Condition>} conditions
 * @returns {BodyNode[]}
 */
function walk(first, steps, links, joins, conditions) {
  /** @type {Set<string>} */
  const visited = new Set();

  /** @param {string} oid @returns {Step} */
  const visit = (oid) => {
    if (visited.has(oid)) throw new FormatError(`step ${oid} is reached twice`);
    visited.add(oid);
    return /** @type {Step} */ (steps.get(oid));
  };

  /** @param {string} oid @returns {string | null} */
  const nextOf = (oid) => {
    const outs = links.get(oid) ?? [];
    if (outs.some((l) => l.condition !== null)) throw new FormatError(`step ${oid}: conditional link from a non-split step`);
    if (outs.length > 1) throw new FormatError(`step ${oid}: ${outs.length} out-links`);
    return outs.length ? outs[0].target : null;
  };

  /** @param {Step} split @param {number} depth nesting depth of this fork, from 1 @returns {BodyNode} */
  const fork = (split, depth) => {
    const oid = split.ids.object;
    if (depth > MAX_FORK_DEPTH) throw new FormatError(`split ${oid}: forks nest more than ${MAX_FORK_DEPTH} deep`);
    const join = /** @type {string} */ (joins.get(oid));
    const cid = split.kind === 'Split' ? split.detail.conditionId : null;
    const condition = cid === null ? undefined : conditions.get(cid);
    if (condition === undefined) throw new FormatError(`split ${oid}: no usable condition`);
    /** @type {Map<string, string>} */
    const targets = new Map();
    for (const link of links.get(oid) ?? []) {
      if (link.condition !== condition.id || link.choice === null) {
        throw new FormatError(`split ${oid}: link not keyed by condition ${condition.id}`);
      }
      if (targets.has(link.choice)) throw new FormatError(`split ${oid}: duplicate choice link ${link.choice}`);
      targets.set(link.choice, link.target);
    }
    if (targets.size !== condition.choices.length || condition.choices.some((c) => !targets.has(c.objectId))) {
      throw new FormatError(`split ${oid}: choice links do not match the choices of condition ${condition.id}`);
    }
    const branches = condition.choices.map((choice) => ({
      choice,
      isDefault: choice.objectId === condition.defaultChoice,
      body: seq(/** @type {string} */ (targets.get(choice.objectId)), join, depth),
    }));
    return { type: 'fork', split, join: visit(join), condition, branches };
  };

  /** @param {string} start @param {string | null} stop @param {number} depth forks around this sequence @returns {BodyNode[]} */
  const seq = (start, stop, depth) => {
    /** @type {BodyNode[]} */
    const nodes = [];
    /** @type {string | null} */
    let cur = start;
    while (cur !== stop) {
      if (cur === null) throw new FormatError(`a branch ends before reaching its join ${stop}`);
      const step = visit(cur);
      if (step.kind === 'Join') {
        throw new FormatError(`join ${cur} is reached outside its fork (expected ${stop ?? 'the end of the program'})`);
      }
      if (step.kind === 'Split') {
        const node = fork(step, depth + 1);
        nodes.push(node);
        cur = nextOf(exitOf(node));
      } else {
        nodes.push({ type: 'step', step });
        cur = nextOf(cur);
      }
    }
    return nodes;
  };

  const body = seq(first, null, 0);
  const unreached = [...steps.keys()].filter((oid) => !visited.has(oid));
  if (unreached.length) throw new FormatError(`unreachable steps ${unreached.join(', ')}`);
  return body;
}

/**
 * The linked body of a program, or a FormatError saying why the links cannot be trusted.
 * @param {Record<string, Json>} doc
 * @param {Step[]} stepList
 * @param {ReadonlyMap<string, Step>} steps by ObjectId
 * @param {[string, string][]} pairs
 * @param {Condition[]} conditions
 * @returns {BodyNode[]}
 */
function linkedBody(doc, stepList, steps, pairs, conditions) {
  if (steps.size !== stepList.length) throw new FormatError('two steps share an ObjectId');
  const first = guidField(doc, 'FirstStepId', 'program');
  const last = guidField(doc, 'LastStepId', 'program');
  if (first === null) {
    if (steps.size || last !== null) throw new FormatError(`nil FirstStepId but ${steps.size} steps`);
    return [];
  }
  if (!steps.has(first)) throw new FormatError(`FirstStepId ${first} is not a step of this program`);
  const body = walk(first, steps, readLinks(doc, steps), joinOf(pairs, steps), new Map(conditions.map((c) => [c.id, c])));
  const exit = exitOf(/** @type {BodyNode} */ (body.at(-1)));
  if (exit !== last) throw new FormatError(`the walk ends at ${exit}, LastStepId is ${last}`);
  return body;
}

/** Rank order: (rank, label), unranked last. @param {Step} a @param {Step} b */
function byRank(a, b) {
  const ra = a.rank ?? Infinity;
  const rb = b.rank ?? Infinity;
  if (ra !== rb) return ra < rb ? -1 : 1;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

// --- program -------------------------------------------------------------------------------------

/**
 * The body, conditions and copy references of program `row`.
 * @param {InstanceRow} row
 * @param {HeadData} head
 * @param {ReadonlyMap<string, InstanceRow[]>} children
 * @param {{ warn: Report, error: Report }} report
 * @returns {Pick<Program, 'body' | 'conditions' | 'copyRefs' | 'order'>}
 */
function programContent(row, head, children, { warn, error }) {
  /** @type {Record<string, Json> | null} */
  const doc = lenient(() => docBody(row, head.docs), error);

  /** @type {[InstanceRow, StepKind][]} */
  const stepRows = [];
  /** @type {Map<string, InstanceRow>} */
  const strings = new Map();
  for (const kid of children.get(row.element) ?? []) {
    const kind = STEP_KINDS[kid.type];
    if (kind !== undefined) {
      stepRows.push([kid, kind]);
    } else if (kid.type === 'EdfString') {
      if (strings.has(kid.object)) warn(`two child strings with ObjectId ${kid.object}; the first is used`);
      else strings.set(kid.object, kid);
    } else {
      warn(`unexpected child ${kid.type} ${kid.element}; ignored`);
    }
  }

  const conditions = doc ? readConditions(doc, strings, head.docs, warn) : [];
  const ranks = doc ? readRanks(doc, warn) : new Map();
  const conditionIds = new Set(conditions.map((c) => c.id));
  const stepList = stepRows.map(([kid, kind]) => buildStep(kid, kind, { head, children, ranks, conditionIds }));
  /** @type {Map<string, Step>} */
  const steps = new Map();
  for (const step of stepList) if (!steps.has(step.ids.object)) steps.set(step.ids.object, step);
  if (doc) {
    for (const step of stepList) if (step.rank === null) warn(`step ${step.ids.object} has no Ranks entry`);
    for (const oid of ranks.keys()) if (!steps.has(oid)) warn(`Ranks entry ${oid} is not a step of this program`);
  }

  const { pairs, copyRefs } = doc ? readRelations(doc, steps, warn) : { pairs: [], copyRefs: [] };

  /** @type {Program['order']} */
  let order = 'links';
  /** @type {BodyNode[]} */
  let body;
  try {
    if (doc === null) throw new FormatError('the program document is unreadable');
    body = linkedBody(doc, stepList, steps, pairs, conditions);
  } catch (err) {
    if (!(err instanceof FormatError)) throw err;
    warn(`steps are shown in rank order: ${err.message}`);
    order = 'rank';
    body = [...stepList].sort(byRank).map((step) => ({ type: 'step', step }));
  }

  /** @type {Map<string, number>} */
  const index = new Map();
  displaySteps(body).forEach((s, i) => { if (!index.has(s.ids.object)) index.set(s.ids.object, i); });
  const at = (/** @type {string} */ oid) => index.get(oid) ?? Infinity;
  copyRefs.sort((a, b) => at(a.source) - at(b.source) || at(a.target) - at(b.target));
  return { body, conditions, copyRefs, order };
}

/**
 * Build one program. Never throws: whatever goes wrong becomes a problem on the program or on
 * one of its steps.
 * @param {InstanceRow} row
 * @param {{ head: HeadData, children: ReadonlyMap<string, InstanceRow[]>, dirPath: string[] }} ctx
 *   children: `childIndex` of the head; dirPath: labels from the region down
 * @returns {Program}
 */
export function buildProgram(row, { head, children, dirPath }) {
  const key = `${head.fileId}:p:${row.element}`;
  /** @type {Problem[]} */
  const problems = [];
  /** @param {Problem['level']} level @returns {Report} */
  const report = (level) => (message) => problems.push({ level, where: key, message });
  /** @type {Pick<Program, 'body' | 'conditions' | 'copyRefs' | 'order'>} */
  let content = { body: [], conditions: [], copyRefs: [], order: 'links' };
  try {
    content = programContent(row, head, children, { warn: report('warning'), error: report('error') });
  } catch (err) {
    report('error')(`unexpected error while reading the program: ${errorText(err)}`);
  }
  const label = labelOf(row, head.instances, head.docs, report('warning'));
  return {
    key,
    ids: { element: row.element, object: row.object },
    label,
    comment: commentOf(row, head.instances, head.docs, report('warning')),
    tags: row.tags,
    path: [...dirPath, label],
    ...content,
    problems,
  };
}

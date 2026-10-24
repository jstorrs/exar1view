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
/** @typedef {import('./spec.js').ProgramSpec} ProgramSpec */

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

/**
 * XProtocol text shaped like a real protocol's `Data`: one ASCCONV block per (sub-)protocol, with
 * padded `key = value` lines, inside XProtocol parameter maps.
 * @param {import('./spec.js').ProtocolSpec} blocks
 */
function protocolText(blocks) {
  const ascconv = blocks.map((b) => [
    '### ASCCONV BEGIN object=MrProtDataImpl@MrProtocolData version=51130001 converter=%MEASCONST%/ConverterList/Prot_Converter.txt ###',
    ...Object.entries(b).map(([k, v]) => `${k.padEnd(40)} = ${v}`),
    '### ASCCONV END ###',
  ].join('\n'));
  return ['<XProtocol> ', '{', '  <Name> "PhoenixMetaProtocol" ', '  <ParamMap."Properties"> { <ParamBool."AutoLoad">  { "true" } }',
    ...ascconv.map((a, i) => `  <ParamString."Protocol${i}"> { "" }\n${a}`), '}', ''].join('\n');
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

  /** @param {Label} label @param {string} parent @param {string} [object] */
  function addString(label, parent, object) {
    const j = jsonNet();
    const added = addInstance({
      type: 'EdfString', parent, object,
      body: j.obj({ Dates: j.obj({}), Texts: j.obj(texts(label)) }),
    });
    finalMap.push([added.element, added.instance]);
    return added;
  }

  const DATA = 'syngo.MR.ExamDataFoundation.Data';
  /** @param {string} name */
  const typeName = (name) => `${DATA}.${name}, ${DATA}`;
  const sha1 = (/** @type {string} */ text) => createHash('sha1').update(text).digest('hex');

  /**
   * A step document of `kind`, shaped like the real ones.
   * @param {ReturnType<typeof jsonNet>} j
   * @param {import('./spec.js').StepSpec} step
   * @param {string | null} conditionId
   */
  function stepBody(j, step, conditionId) {
    switch (step.kind) {
      case 'Measurement':
        return j.obj({
          BodyPartExamined: 'HEAD', ImageComment: '',
          Laterality: step.laterality === undefined ? '' : step.laterality, OpenBeforeStart: false,
          StudyParts: j.values([]),
          VoiceCommands: j.obj({ AreValid: true, Pause: '00:00:00', PostSoundId: '', PreSoundId: '', VoiceCommandsType: 0 }),
        });
      case 'Pause':
        return j.obj({
          ApplyContrastAgent: false,
          ContrastAgent: j.obj({
            ActiveIngredient: '', CodeValue: '', CodingScheme: '', Comment: '', Concentration: '', Dilution: '',
            IsGiven: false, Name: '', TotalDose: '', Volume: '',
          }),
          ContrastAgentName: '',
        });
      case 'Interaction':
        return j.obj({ OpenBeforeStart: true });
      case 'Decision':
        return j.obj({ ConditionId: conditionId, OpenBeforeStart: false });
      case 'Workflow':
        return j.obj({});
      case 'Split':
      case 'Join':
        return j.obj({ ConditionId: conditionId });
    }
  }

  /**
   * A program's steps (with their strings, protocols and add-ins) and condition strings as its
   * children, then its document. The "To" maps hold Json.NET `$ref`s to the "From" entries, as
   * real files do.
   * @param {ProgramSpec} p
   * @param {string} pElement
   * @returns {object} the program document
   */
  function addProgramContent(p, pElement) {
    const steps = p.steps ?? [];
    /** @type {Map<string, string>} name -> ObjectId: steps, conditions, choices */
    const ids = new Map();
    /** @param {string} name */
    const idOf = (name) => {
      if (!ids.has(name)) ids.set(name, guid('b', next('o')));
      return /** @type {string} */ (ids.get(name));
    };
    /** @param {Label} label @param {string} name */
    const conditionString = (label, name) => {
      const object = idOf(name);
      addString(label, pElement, object);
      return object;
    };

    // one $id counter for the whole program document, as Json.NET writes it
    const j = jsonNet();
    /** @param {string} object */
    const ref = (object) => j.obj({ FullName: `${DATA}.EdfString`, ObjectId: object });
    /** @type {Record<string, object>} */
    const conditions = {};
    for (const c of p.conditions ?? []) {
      const choiceIds = c.choices.map((label) => conditionString(label, `${c.name}:${label}`));
      const description = c.description === undefined ? idOf(`${c.name}:description`) : conditionString(c.description, `${c.name}:description`);
      conditions[idOf(c.name)] = j.obj({
        $type: typeName('EdfProgramCondition'),
        Choices: j.values(choiceIds.map(ref)),
        Description: ref(description),
        Id: idOf(c.name),
        IsDecicion: c.kind === 'Decision',
        IsStrategy: c.kind === 'Strategy',
        Kind: c.kind === 'Decision' ? 1 : 0,
        Label: ref(conditionString(c.label, `${c.name}:label`)),
        SelectionId: choiceIds[0],
      });
    }

    for (const step of steps) {
      const sj = jsonNet();
      const element = guid('e', next('e'));
      const label = addString(step.label ?? step.name, element).element;
      const description = step.comment === undefined ? null : addString(step.comment, element).element;
      const conditionId = step.condition === undefined ? null : idOf(step.condition);
      const added = addInstance({
        type: `Edf${step.kind}Step`, element, object: idOf(step.name), label, description, parent: pElement,
        body: stepBody(sj, step, conditionId),
      });
      finalMap.push([element, added.instance]);
      if (step.kind === 'Measurement') {
        const blocks = step.protocol ?? [{ tSequenceFileName: '"%SiemensSeq%\\gre"', tProtocolName: JSON.stringify(step.name) }];
        const text = protocolText(blocks);
        const pj = jsonNet();
        const preview = (/** @type {string} */ label, /** @type {string} */ unit, /** @type {string} */ value) =>
          [label, pj.obj({ Label: label, Unit: unit, Value: value })];
        const protocol = addInstance({
          type: 'EdfProtocol', parent: element, tags: tagString({ ContentHash: sha1(text), SystemConfiguration: '021 / XR' }),
          body: pj.obj({
            Data: text,
            Preview: pj.obj(Object.fromEntries([preview('TR', 'ms', blocks[0]['alTR[0]'] ?? '20'), preview('TA', '', '1:00')])),
            UpgradeInfo: '',
          }),
        });
        finalMap.push([protocol.element, protocol.instance]);
      }
      if (step.addIn || ['Interaction', 'Decision', 'Workflow'].includes(step.kind)) {
        const data = '<AddInDataModel />';
        const aj = jsonNet();
        const addIn = addInstance({
          type: 'EdfAddInConfig', parent: element, tags: tagString({ ContentHash: sha1(data) }),
          body: aj.obj({ Data: data, Name: 'Dot', VoiceCommands: aj.obj({}) }),
        });
        finalMap.push([addIn.element, addIn.instance]);
      }
    }

    const names = steps.map((st) => st.name);
    const links = p.links ?? names.slice(1).map((name, i) => /** @type {[string, string]} */ ([names[i], name]));
    /** @param {import('./spec.js').LinkSpec} l */
    const link = (l) => j.obj({
      $type: typeName('EdfProgramLink'),
      ConditionId: l.length === 4 ? idOf(l[2]) : NIL,
      SelectionId: l.length === 4 ? idOf(`${l[2]}:${l[3]}`) : NIL,
      SourceId: idOf(l[0]),
      TargetId: idOf(l[1]),
    });
    /**
     * @param {string} source @param {string} target @param {string} kind
     * @param {{ data?: string, state?: string, constraint?: number }} [o]
     */
    const relation = (source, target, kind, { data = '', state = '', constraint = 0 } = {}) => j.obj({
      $type: typeName('EdfProgramRelation'),
      Constraint: constraint, Data: data, Kind: kind, SourceId: idOf(source), State: state, TargetId: idOf(target),
    });
    const copyData = (/** @type {string} */ group) =>
      '<EdfCopyReferenceParameters xmlns="clr-namespace:syngo.MR.ExamDataFoundation.Data;assembly=syngo.MR.ExamDataFoundation.Data" '
      + `CopyPhaseEncodingDirection="False" CopySteps="False" Group="${group}" IgnoreLastStep="False" IgnoreMeasurements="False" />`;
    const relations = [
      ...(p.pairs ?? []).map(([split, join]) => relation(split, join, 'SplitJoin')),
      ...(p.pairs ?? []).map(([split, join]) => relation(join, split, 'SplitJoin')),
      ...(p.copyRefs ?? []).map((c) => relation(c.source, c.target, 'CopyReference',
        { data: copyData(c.group), state: c.broken ? 'Broken' : '', constraint: 1 })),
      ...(p.opaque ?? []).map(([source, target]) => relation(source, target, '')),
    ];
    const linkObjs = links.map(link);
    /**
     * Every step's list in a "From" map and the matching `$ref` list in its "To" map.
     * @param {any[]} items
     */
    const fromTo = (items) => ({
      from: j.obj(Object.fromEntries(names.map((n) => [idOf(n), j.values(items.filter((it) => it.SourceId === idOf(n)))]))),
      to: j.obj(Object.fromEntries(names.map((n) => [idOf(n), j.values(items.filter((it) => it.TargetId === idOf(n)).map((it) => ({ $ref: it.$id })))]))),
    });
    const l = fromTo(linkObjs);
    const r = fromTo(relations);
    return j.obj({
      BodyPartExamined: '', Conditions: j.obj(conditions),
      FirstStepId: names.length ? idOf(names[0]) : NIL, LastStepId: names.length ? idOf(names[names.length - 1]) : NIL,
      Laterality: '', LinksFrom: l.from, LinksTo: l.to,
      Ranks: j.obj(Object.fromEntries(names.map((n, i) => [idOf(n), j.obj({ Rank: i, StepId: idOf(n) })]))),
      RelationsFrom: r.from, RelationsTo: r.to,
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

  /** @param {DirSpec} dir @param {string} parentOid @param {string} parentElement */
  function addDirectory(dir, parentOid, parentElement) {
    const element = guid('e', next('e'));
    const object = guid('b', next('o'));
    const j = jsonNet();
    const label = addString(dir.label, element).element;
    const description = dir.comment === undefined ? null : addString(dir.comment, element).element;
    const added = addInstance({
      type: 'EdfDirectory', element, object, label, description, parent: parentElement,
      body: j.obj({ BodyPartExamined: '', IsProtected: dir.isProtected ?? false, Laterality: '', Password: dir.password ?? '' }),
    });
    finalMap.push([element, added.instance]);
    structure.parents[object] = parentOid;
    structure.subdirs[object] = (dir.dirs ?? []).map((d) => addDirectory(d, object, element));
    structure.subprograms[object] = (dir.programs ?? []).map((p) => {
      const pElement = guid('e', next('e'));
      const pLabel = addString(p.label, pElement).element;
      const pDescription = p.comment === undefined ? null : addString(p.comment, pElement).element;
      const prog = addInstance({
        type: 'EdfProgram', element: pElement, label: pLabel, description: pDescription, tags: tagString(p.tags),
        parent: element, body: addProgramContent(p, pElement),
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

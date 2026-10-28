// @ts-check
/**
 * What the step facts panel shows (adapted from protocols-web core/stepinfo.js): labelled
 * facts per kind, tags, and copy references with the step at the other end resolved. Pure.
 */
import { displaySteps, measurementDetail } from './model.js';
import { copyRefMarks } from './body.js';
import { visibleControls } from './visible.js';

/** @typedef {import('./model.js').Program} Program */
/** @typedef {import('./model.js').Step} Step */
/** @typedef {import('./model.js').CopyRef} CopyRef */
/** @typedef {import('./addin.js').AddIn} AddIn */
/** The add-ins read from a file, by add-in blob. @typedef {ReadonlyMap<string, AddIn>} AddIns */
/** `value` null: not set in the file. @typedef {{label: string, value: string | null}} Fact */
/**
 * @typedef {object} CopyRefInfo
 * @property {'to' | 'from'} direction this step copies to / from the other
 * @property {string} other label of the step at the other end
 * @property {number} number the scanner's tag number: that of the reference's source step (sources count 1, 2, … in display order)
 * @property {string} group
 * @property {string} scope the group in words
 * @property {string[]} flags the options that are set, in words
 * @property {boolean} broken
 */

/** @param {boolean | null} b */
const yesNo = (b) => (b === null ? null : b ? 'yes' : 'no');

/** No add-in has been read. @type {AddIns} */
export const NO_ADDINS = new Map();

/**
 * The add-in fact: its name once read, else whether there is one.
 * @param {string | null} blob @param {AddIns} addIns
 */
function addInFact(blob, addIns) {
  if (blob === null) return 'none';
  const a = addIns.get(blob);
  if (!a) return 'present';
  if (!a.ok) return `present (could not be read: ${visibleControls(a.error)})`;
  return a.name === null ? 'present (no type named)' : visibleControls(a.name);
}

/**
 * JSON text pretty-printed (the reader stores the contrast agent as canonical JSON).
 * @param {string} text
 */
export const prettyJson = (text) => JSON.stringify(JSON.parse(text), null, 2);

/**
 * The condition with `id`, as facts: "<kind>: <label>" and the choices (default marked).
 * @param {string | null} id
 * @param {Program} program
 * @returns {Fact[]}
 */
function conditionFacts(id, program) {
  if (id === null) return [{ label: 'Condition', value: null }];
  const cond = program.conditions.find((c) => c.id === id);
  if (!cond) return [{ label: 'Condition', value: `${id} (missing)` }];
  return [
    { label: 'Condition', value: `${cond.kind}: ${cond.label}` },
    ...(cond.description ? [{ label: 'Description', value: cond.description }] : []),
    {
      label: 'Choices',
      value: cond.choices.map((c) => (c.objectId === cond.defaultChoice ? `${c.label} (default)` : c.label)).join(', '),
    },
  ];
}

/**
 * @param {Step} step
 * @param {Program} program
 * @param {AddIns} [addIns] names the add-ins read so far
 * @returns {Fact[]}
 */
export function stepFacts(step, program, addIns = NO_ADDINS) {
  /** @type {Fact[]} */
  const facts = [
    { label: 'Kind', value: step.kind },
    { label: 'Label', value: step.label },
    { label: 'Comment', value: step.comment },
    { label: 'Rank', value: step.rank === null ? null : String(step.rank) },
  ];
  switch (step.kind) {
    case 'Measurement': {
      const d = step.detail;
      facts.push(
        { label: 'Body part', value: d.bodyPart },
        { label: 'Laterality', value: d.laterality },
        { label: 'Image comment', value: d.imageComment },
        { label: 'Open before start', value: yesNo(d.openBeforeStart) },
        { label: 'Add-in', value: addInFact(d.addInBlob, addIns) });
      break;
    }
    case 'Pause': {
      const d = step.detail;
      facts.push(
        { label: 'Apply contrast agent', value: yesNo(d.applyContrastAgent) },
        { label: 'Contrast agent name', value: d.contrastAgentName },
        { label: 'Contrast agent', value: d.contrastAgent === null ? null : prettyJson(d.contrastAgent) });
      break;
    }
    case 'Interaction':
      facts.push(
        { label: 'Open before start', value: yesNo(step.detail.openBeforeStart) },
        { label: 'Add-in', value: addInFact(step.detail.addInBlob, addIns) });
      break;
    case 'Workflow':
      facts.push({ label: 'Add-in', value: addInFact(step.detail.addInBlob, addIns) });
      break;
    case 'Decision':
      facts.push(
        ...conditionFacts(step.detail.conditionId, program),
        { label: 'Open before start', value: yesNo(step.detail.openBeforeStart) },
        { label: 'Add-in', value: addInFact(step.detail.addInBlob, addIns) });
      break;
    case 'Split':
    case 'Join':
      facts.push(...conditionFacts(step.detail.conditionId, program));
      break;
    default:
      break;
  }
  return facts;
}

/** The Content hash of the step's add-in, or null (Measurement, Interaction, Workflow, Decision may have one). @param {Step} step @returns {string | null} */
export const addInBlobOf = (step) => ('addInBlob' in step.detail ? step.detail.addInBlob : null);

/**
 * What the protocol panel can show of a step: a summary of its protocol and add-in, its
 * protocol as the scanner's printed cards, as XProtocol text or as ASCCONV parameters, or its add-in.
 * @typedef {'summary' | 'cards' | 'xprotocol' | 'ascconv' | 'addin'} StepView
 */

/**
 * A view of a step with what it reads: the Summary both the protocol and the add-in (null: none),
 * the others one blob.
 * @typedef {{ view: 'summary', protocol: string | null, addIn: string | null }
 *   | { view: Exclude<StepView, 'summary'>, blob: string }} StepViewSource
 */

/**
 * The views `step` has, in tab order: Summary when it has a protocol or an add-in, Cards,
 * XProtocol and ASCCONV when it has a protocol, Add-in when it has an add-in.
 * @param {Step} step
 * @returns {StepViewSource[]}
 */
export function stepViews(step) {
  const protocol = measurementDetail(step)?.protocolBlob ?? null;
  const addIn = addInBlobOf(step);
  return [
    ...(protocol === null && addIn === null ? [] : [{ view: /** @type {const} */ ('summary'), protocol, addIn }]),
    ...(protocol === null ? [] : [{ view: /** @type {const} */ ('cards'), blob: protocol }, { view: /** @type {const} */ ('xprotocol'), blob: protocol }, { view: /** @type {const} */ ('ascconv'), blob: protocol }]),
    ...(addIn === null ? [] : [{ view: /** @type {const} */ ('addin'), blob: addIn }]),
  ];
}

/**
 * The view to show of `views` (a step's, see stepViews) when the user chose `chosen`: that one
 * when the step has it, else the first; null when there is none.
 * @param {readonly StepView[]} views
 * @param {StepView} chosen
 * @returns {StepView | null}
 */
export function shownView(views, chosen) {
  return views.includes(chosen) ? chosen : views[0] ?? null;
}

/**
 * The add-in box of a step list row, null without an add-in: the type's name once read.
 * @param {Step} step
 * @param {AddIns} addIns
 * @returns {{text: string, title: string, aria: string} | null}
 */
export function addInView(step, addIns) {
  const blob = addInBlobOf(step);
  if (blob === null) return null;
  const a = addIns.get(blob);
  if (!a) return { text: 'Add-in', title: 'This step has an add-in', aria: 'add-in' };
  if (!a.ok) return { text: 'Add-in', title: `The add-in could not be read: ${visibleControls(a.error)}`, aria: 'add-in' };
  if (a.name === null) return { text: 'Add-in', title: 'The add-in names no type', aria: 'add-in' };
  const name = visibleControls(a.name);
  return { text: name, title: a.raw === null ? name : visibleControls(a.raw), aria: `add-in ${name}` };
}

/** @param {Step} step @returns {[string, string][]} */
export const stepTags = (step) => Object.entries(step.tags);

/**
 * The contrast agent a Pause applies ("contrast agent" when it has no name), else null.
 * @param {Step} step
 */
export function contrastNote(step) {
  if (step.kind !== 'Pause' || step.detail.applyContrastAgent !== true) return null;
  return step.detail.contrastAgentName || 'contrast agent';
}

/** 'CopyPhaseEncodingDirection' → 'copy phase encoding direction'. @param {string} name */
const words = (name) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/**
 * Copy references of every step, by step ObjectId: outgoing first, then incoming. Sources are numbered
 * in display order, and every reference carries its source's number.
 * @param {Program} program
 * @returns {Map<string, CopyRefInfo[]>}
 */
export function copyRefIndex(program) {
  const steps = displaySteps(program.body);
  const labels = new Map(steps.map((s) => [s.ids.object, s.label]));
  const marks = copyRefMarks(program);
  /** @type {Map<string, number>} */
  const numbers = new Map();
  for (const { ids } of steps) {
    if (marks.get(ids.object)?.outgoing.length && !numbers.has(ids.object)) numbers.set(ids.object, numbers.size + 1);
  }
  /** @param {'to' | 'from'} direction @param {CopyRef} r @param {string} otherId @returns {CopyRefInfo} */
  const info = (direction, r, otherId) => ({
    direction,
    // The reader keeps only references between measurement steps of the program.
    other: /** @type {string} */ (labels.get(otherId)),
    number: /** @type {number} */ (numbers.get(r.source)),
    group: r.group,
    scope: words(r.group),
    flags: Object.entries(r.flags).flatMap(([k, on]) => (on ? [words(k)] : [])),
    broken: r.broken,
  });
  /** @type {Map<string, CopyRefInfo[]>} */
  const out = new Map();
  for (const [id, m] of marks) {
    out.set(id, [...m.outgoing.map((r) => info('to', r, r.target)), ...m.incoming.map((r) => info('from', r, r.source))]);
  }
  return out;
}

/**
 * @param {Step} step
 * @param {ReadonlyMap<string, CopyRefInfo[]>} index from copyRefIndex
 * @returns {CopyRefInfo[]}
 */
export const stepCopyRefs = (step, index) => index.get(step.ids.object) ?? [];

/**
 * What a copy reference says, the other step's label and the group with controls made visible:
 * "copied from X · slices · copy steps (broken)".
 * @param {CopyRefInfo} r
 */
export function copyRefText(r) {
  const parts = [`${r.direction === 'to' ? 'copies to' : 'copied from'} ${visibleControls(r.other)}`, visibleControls(r.scope), ...r.flags];
  return parts.join(' · ') + (r.broken ? ' (broken)' : '');
}

/** The tooltip line: "Copy reference 1: copies to X · slices". @param {CopyRefInfo} r */
export const copyRefLine = (r) => `Copy reference ${r.number}: ${copyRefText(r)}`;

/** The facts-panel line: "1 · Copies to X · slices". @param {CopyRefInfo} r */
export const copyRefFact = (r) => {
  const text = copyRefText(r);
  return `${r.number} · ${text.charAt(0).toUpperCase()}${text.slice(1)}`;
};

/**
 * @typedef {object} CopyTag
 * @property {'source' | 'destination'} role
 * @property {number} number
 * @property {boolean} broken
 * @property {string} title tooltip, one line per reference
 * @property {string} aria spoken form
 */

/**
 * The tags a step shows, as on the scanner: one source tag when it copies to others, one
 * destination tag per reference it receives.
 * @param {readonly CopyRefInfo[]} refs from stepCopyRefs
 * @returns {CopyTag[]}
 */
export function copyTags(refs) {
  const out = refs.filter((r) => r.direction === 'to');
  /** @type {CopyTag[]} */
  const tags = [];
  if (out.length) {
    tags.push({
      role: 'source', number: out[0].number, broken: out.some((r) => r.broken), title: out.map(copyRefLine).join('\n'),
      aria: `copy reference ${out[0].number} source, ${out.length} ${out.length === 1 ? 'destination' : 'destinations'}`,
    });
  }
  for (const r of refs) {
    if (r.direction === 'from') {
      tags.push({
        role: 'destination', number: r.number, broken: r.broken, title: copyRefLine(r),
        aria: `copy reference ${r.number} destination, from ${visibleControls(r.other)}`,
      });
    }
  }
  return tags.map((g) => ({ ...g, aria: g.aria + (g.broken ? ', broken' : '') }));
}

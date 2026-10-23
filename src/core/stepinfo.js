// @ts-check
/**
 * What the step facts panel shows (adapted from protocols-web core/stepinfo.js): labelled
 * facts per kind, tags, and copy references with the step at the other end resolved. Pure.
 */
import { displaySteps } from './model.js';
import { copyRefMarks } from './body.js';
import { visibleControls } from './visible.js';

/** @typedef {import('./model.js').Program} Program */
/** @typedef {import('./model.js').Step} Step */
/** @typedef {import('./model.js').CopyRef} CopyRef */
/** `value` null: not set in the file. @typedef {{label: string, value: string | null}} Fact */
/**
 * @typedef {object} CopyRefInfo
 * @property {'to' | 'from'} direction this step copies to / from the other
 * @property {string} other label of the step at the other end
 * @property {string} group
 * @property {string[]} flags the options that are set, in words
 * @property {boolean} broken
 */

/** @param {boolean | null} b */
const yesNo = (b) => (b === null ? null : b ? 'yes' : 'no');

/** @param {string | null} blob */
const present = (blob) => (blob === null ? 'none' : 'present');

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
 * @returns {Fact[]}
 */
export function stepFacts(step, program) {
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
        { label: 'Add-in', value: present(d.addInBlob) });
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
        { label: 'Add-in', value: present(step.detail.addInBlob) });
      break;
    case 'Workflow':
      facts.push({ label: 'Add-in', value: present(step.detail.addInBlob) });
      break;
    case 'Decision':
      facts.push(
        ...conditionFacts(step.detail.conditionId, program),
        { label: 'Open before start', value: yesNo(step.detail.openBeforeStart) },
        { label: 'Add-in', value: present(step.detail.addInBlob) });
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
 * Copy references of every step, by step ObjectId: outgoing first, then incoming.
 * @param {Program} program
 * @returns {Map<string, CopyRefInfo[]>}
 */
export function copyRefIndex(program) {
  const labels = new Map(displaySteps(program.body).map((s) => [s.ids.object, s.label]));
  /** @param {'to' | 'from'} direction @param {CopyRef} r @param {string} otherId @returns {CopyRefInfo} */
  const info = (direction, r, otherId) => ({
    direction,
    // The reader keeps only references between measurement steps of the program.
    other: /** @type {string} */ (labels.get(otherId)),
    group: r.group,
    flags: Object.entries(r.flags).flatMap(([k, on]) => (on ? [words(k)] : [])),
    broken: r.broken,
  });
  /** @type {Map<string, CopyRefInfo[]>} */
  const out = new Map();
  for (const [id, m] of copyRefMarks(program)) {
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
 * One line about a copy reference, the other step's label with its controls made visible.
 * @param {CopyRefInfo} r
 */
export function copyRefLine(r) {
  return `${r.direction === 'to' ? 'Copies to' : 'Copied from'} ${visibleControls(r.other)}${r.broken ? ' (broken)' : ''}`;
}

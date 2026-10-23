// @ts-check
/**
 * Compact description of a synthetic exar1 (all names are invented).
 * A label is a string (English text) or a language -> text map.
 *
 * @typedef {string | Record<string, string>} Label
 *
 * A step. `name` identifies it in links, pairs and copy references; the label defaults to it.
 * A Measurement always has a protocol child and an add-in when `addIn`; Interaction, Decision
 * and Workflow steps always have an add-in. `condition` names the condition of a Decision,
 * Split or Join step.
 * @typedef {{
 *   name: string, kind: import('../../src/core/model.js').StepKind, label?: Label, comment?: string,
 *   condition?: string, addIn?: boolean, laterality?: string | null,
 * }} StepSpec
 *
 * A condition; `choices` are the choice labels (and their names in links), the first is the
 * default. Without `description` the Description reference dangles, as it does in real files.
 * @typedef {{ name: string, kind: 'Strategy' | 'Decision', label: Label, choices: string[], description?: string }} ConditionSpec
 *
 * A link: source, target, and for a split's branch the condition and choice names. A name that
 * is not a step of the program becomes an unknown ObjectId.
 * @typedef {[string, string] | [string, string, string, string]} LinkSpec
 *
 * @typedef {{ source: string, target: string, group: string, broken?: boolean }} CopyRefSpec
 *
 * A program; `links` defaults to the steps in order, `pairs` are (split, join) and are recorded
 * in both directions, `opaque` are `Kind = ""` relations.
 * @typedef {{
 *   label: Label, comment?: string, tags?: Record<string, string>,
 *   steps?: StepSpec[], links?: LinkSpec[], conditions?: ConditionSpec[], pairs?: [string, string][],
 *   copyRefs?: CopyRefSpec[], opaque?: [string, string][],
 * }} ProgramSpec
 *
 * @typedef {{
 *   label: Label, comment?: string, isProtected?: boolean, password?: string,
 *   dirs?: DirSpec[], programs?: ProgramSpec[],
 * }} DirSpec
 * @typedef {{ baseline: string, root: DirSpec }} ExarSpec
 */

/** @type {ProgramSpec} Measurement with protocol and add-in, a commented Pause, an Interaction. */
const linear = {
  label: 'Localizer',
  tags: { Archive: 'True' },
  steps: [
    { name: 'loc', kind: 'Measurement', label: 'Three-plane localizer', addIn: true },
    { name: 'pause', kind: 'Pause', label: 'Position check', comment: 'Ask the patient to keep still' },
    { name: 'coil', kind: 'Interaction', label: 'Confirm coil' },
  ],
};

/**
 * A Strategy fork with an empty branch and, inside its first branch, a Decision step and a
 * Decision fork. The inner split's links are stored in the opposite order to its choices.
 * Display order: survey, [variant: [ask, [contrast: [inject, t1post], [t1]], t2], [t2fast], []], send.
 * @type {ProgramSpec}
 */
const branching = {
  label: 'Axial T2',
  comment: 'Check the coil',
  tags: { SystemConfiguration: '021 / XR', Archive: 'True' },
  conditions: [
    { name: 'variant', kind: 'Strategy', label: 'Variant', choices: ['Standard', 'Fast', 'Skip'], description: 'Pick a variant' },
    { name: 'contrast', kind: 'Decision', label: 'Contrast agent', choices: ['With contrast', 'Without contrast'] },
  ],
  steps: [
    { name: 'survey', kind: 'Measurement', label: 'Survey' },
    { name: 's1', kind: 'Split', label: 'Split', condition: 'variant' },
    { name: 'ask', kind: 'Decision', label: 'Contrast?', condition: 'contrast' },
    { name: 's2', kind: 'Split', label: 'Split', condition: 'contrast' },
    { name: 'inject', kind: 'Pause', label: 'Inject contrast' },
    { name: 't1post', kind: 'Measurement', label: 'T1 post' },
    { name: 't1', kind: 'Measurement', label: 'T1 native' },
    { name: 'j2', kind: 'Join', label: 'Join', condition: 'contrast' },
    { name: 't2', kind: 'Measurement', label: { de: 'T2 TSE transversal' } },
    { name: 't2fast', kind: 'Measurement', label: 'T2 fast' },
    { name: 'j1', kind: 'Join', label: 'Join', condition: 'variant' },
    { name: 'send', kind: 'Workflow', label: 'Send images' },
  ],
  links: [
    ['survey', 's1'],
    ['s1', 'ask', 'variant', 'Standard'],
    ['s1', 't2fast', 'variant', 'Fast'],
    ['s1', 'j1', 'variant', 'Skip'],
    ['ask', 's2'],
    ['s2', 't1', 'contrast', 'Without contrast'],
    ['s2', 'inject', 'contrast', 'With contrast'],
    ['inject', 't1post'],
    ['t1post', 'j2'],
    ['t1', 'j2'],
    ['j2', 't2'],
    ['t2', 'j1'],
    ['t2fast', 'j1'],
    ['j1', 'send'],
  ],
  pairs: [['s1', 'j1'], ['s2', 'j2']],
};

/** @type {ProgramSpec} A link to a step that does not exist: shown in rank order. */
const brokenLink = {
  label: 'Sagittal T1',
  steps: [
    { name: 'sag', kind: 'Measurement', label: 'Sag T1' },
    { name: 'sagfs', kind: 'Measurement', label: 'Sag T1 FS' },
  ],
  links: [['sag', 'nowhere']],
};

/** @type {ProgramSpec} Copy references stored out of display order, one broken. */
const copies = {
  label: 'Knee PD',
  steps: [
    { name: 'pdsag', kind: 'Measurement', label: 'PD sag', laterality: null },
    { name: 'pdcor', kind: 'Measurement', label: 'PD cor' },
    { name: 't1cor', kind: 'Measurement', label: 'T1 cor' },
  ],
  copyRefs: [
    { source: 'pdcor', target: 't1cor', group: 'Slices', broken: true },
    { source: 'pdsag', target: 'pdcor', group: 'SlicesAndAdjustmentVolume' },
    { source: 'pdsag', target: 't1cor', group: 'Everything' },
  ],
  opaque: [['t1cor', 'pdsag']],
};

/** Root > New Tree > 2 regions > exams > programs, with one empty and one protected exam. */
/** @type {ExarSpec} */
export const defaultSpec = {
  baseline: 'TEST_BASELINE_20200101',
  root: {
    label: 'Root',
    dirs: [{
      label: 'New Tree',
      dirs: [
        {
          label: 'Neuro',
          comment: 'Neuro protocols',
          dirs: [
            { label: 'Head Routine', programs: [linear, branching, brokenLink] },
            { label: 'Empty Exam' },
          ],
        },
        {
          label: 'Ortho',
          dirs: [
            { label: { de: 'Kniegelenk' }, programs: [copies] },
            { label: 'Locked Exam', isProtected: true, password: 'SECRET-PW', programs: [{ label: 'Shoulder Survey' }] },
          ],
        },
      ],
    }],
  },
};

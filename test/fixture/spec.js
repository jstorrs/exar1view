// @ts-check
/**
 * Compact description of a synthetic exar1 (all names are invented).
 * A label is a string (English text) or a language -> text map.
 *
 * @typedef {string | Record<string, string>} Label
 *
 * A protocol's ASCCONV blocks (the first is the main protocol), each key -> raw value.
 * @typedef {Record<string, string>[]} ProtocolSpec
 *
 * A step. `name` identifies it in links, pairs and copy references; the label defaults to it.
 * A Measurement always has a protocol child (`protocol`, by default a small one naming the
 * step; steps with equal protocols share one Content row) and an add-in when `addIn` (a string
 * is the add-in's Name, else 'Dot'); Interaction, Decision and Workflow steps always have an add-in. `condition` names the
 * condition of a Decision, Split or Join step.
 * @typedef {{
 *   name: string, kind: import('../../src/core/model.js').StepKind, label?: Label, comment?: string,
 *   condition?: string, addIn?: boolean | string, laterality?: string | null, protocol?: ProtocolSpec, upgradeInfo?: string,
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
    { name: 'loc', kind: 'Measurement', label: 'Three-plane localizer',
      addIn: 'i18n://syngo.MR.ExamAddIn.Configurations/Resource/AutoAlignScout' },
    { name: 'pause', kind: 'Pause', label: 'Position check', comment: 'Ask the patient to keep still' },
    { name: 'coil', kind: 'Interaction', label: 'Confirm coil' },
  ],
};

/** T1 TSE, used by both T1 steps of Axial T2: they share one protocol blob. @type {ProtocolSpec} */
const t1Protocol = [{
  tSequenceFileName: '"%SiemensSeq%\\tse"',
  tProtocolName: '"t1_tse_tra"',
  'alTR[0]': '600000',
  'alTE[0]': '12000',
  'sKSpace.lBaseResolution': '320',
  'sSliceArray.asSlice[0].dThickness': '5',
  'sSliceArray.asSlice[0].sPosition.dTra': '-12.5',
  'sCoilSelectMeas.aRxCoilSelectData[0].asList[0].lElementSelected': '1',
  lTotalScanTimeSec: '96',
}];

/**
 * T2 TSE with a sub-protocol; the fast variant differs in a few key parameters (TR, TE, base
 * resolution, sub-protocol averages), churn (position, coil, scan time) and an ignored one.
 * @param {{ tr: string, te: string, res: string, pos: string, coil: string, time: string, name: string, averages: string, fat?: string }} v
 * @returns {ProtocolSpec}
 */
const t2Protocol = (v) => [{
  tSequenceFileName: '"%SiemensSeq%\\tse"',
  tProtocolName: v.name,
  'alTR[0]': v.tr,
  'alTE[0]': v.te,
  'sKSpace.lBaseResolution': v.res,
  ...(v.fat === undefined ? {} : { 'sPrepPulses.ucFatSat': v.fat }),
  'sSliceArray.asSlice[0].dThickness': '4',
  'sSliceArray.asSlice[0].sPosition.dTra': v.pos,
  'sCoilSelectMeas.aRxCoilSelectData[0].asList[0].lElementSelected': v.coil,
  lTotalScanTimeSec: v.time,
  'sWipMemBlock.tFree': '"a#b = c"  # a quoted value may hold # and =',
}, {
  lAverages: v.averages,
  'sRXSPEC.lGain': '1',
}];

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
    { name: 't1post', kind: 'Measurement', label: 'T1 post', protocol: t1Protocol },
    { name: 't1', kind: 'Measurement', label: 'T1 native', protocol: t1Protocol },
    { name: 'j2', kind: 'Join', label: 'Join', condition: 'contrast' },
    {
      name: 't2', kind: 'Measurement', label: { de: 'T2 TSE transversal' },
      protocol: t2Protocol({ tr: '4000000', te: '98000', res: '384', pos: '-10', coil: '1', time: '180', name: '"t2_tse_tra"', averages: '2', fat: '1' }),
    },
    {
      name: 't2fast', kind: 'Measurement', label: 'T2 fast',
      protocol: t2Protocol({ tr: '3000000', te: '98000', res: '256', pos: '-14', coil: '0', time: '75', name: '"t2_tse_tra_fast"', averages: '1' }),
    },
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

/**
 * A link to a step that does not exist: shown in rank order. Sag T1 FS references a customer
 * sequence and a customer EVA protocol (for the sequence-reference scan).
 * @type {ProgramSpec}
 */
const brokenLink = {
  label: 'Sagittal T1',
  steps: [
    { name: 'sag', kind: 'Measurement', label: 'Sag T1' },
    {
      name: 'sagfs', kind: 'Measurement', label: 'Sag T1 FS', upgradeInfo: 'Synthetic upgrade note',
      protocol: [{
        tSequenceFileName: '"%CustomerSeq%\\cust_tse_v2"',
        tProtocolName: '"sag_t1_fs"',
        tdefaultEVAProt: '"%CustomerEvaDefProt%\\DTI\\DTI_990.evp"',
      }],
    },
  ],
  links: [['sag', 'nowhere']],
};

/**
 * Copy references stored out of display order, one broken. PD cor references a customer
 * sequence and T1 cor a service one (for the sequence-reference scan).
 * @type {ProgramSpec}
 */
const copies = {
  label: 'Knee PD',
  steps: [
    { name: 'pdsag', kind: 'Measurement', label: 'PD sag', laterality: null },
    {
      name: 'pdcor', kind: 'Measurement', label: 'PD cor',
      protocol: [{ tSequenceFileName: '"%CustomerSeq%\\cust_tse_v2"', tProtocolName: '"pd_cor"' }],
    },
    {
      name: 't1cor', kind: 'Measurement', label: 'T1 cor',
      protocol: [{ tSequenceFileName: '"%ServiceSeq%\\rf_noise_spectrum"', tProtocolName: '"t1_cor"' }],
    },
  ],
  copyRefs: [
    { source: 'pdcor', target: 't1cor', group: 'Slices', broken: true },
    { source: 'pdsag', target: 'pdcor', group: 'SlicesAndAdjustmentVolume' },
    { source: 'pdsag', target: 't1cor', group: 'Everything' },
  ],
  opaque: [['t1cor', 'pdsag']],
};

/**
 * `branching` as edited: T1 native renamed (same protocol), a Pause after the survey, the Fast
 * choice made the default, and the fast T2's protocol changed.
 * @type {ProgramSpec}
 */
const branchingEdited = {
  ...branching,
  conditions: (branching.conditions ?? []).map((c) => (c.name === 'variant' ? { ...c, choices: ['Fast', 'Standard', 'Skip'] } : c)),
  steps: (branching.steps ?? []).flatMap((s) => {
    if (s.name === 't1') return [{ ...s, label: 'T1 native, renamed' }];
    if (s.name === 't2fast') {
      return [{ ...s, protocol: t2Protocol({ tr: '3500000', te: '98000', res: '256', pos: '-14', coil: '0', time: '75', name: '"t2_tse_tra_fast"', averages: '1' }) }];
    }
    return s.name === 'survey' ? [s, /** @type {StepSpec} */ ({ name: 'wait', kind: 'Pause', label: 'Wait a moment' })] : [s];
  }),
  links: (branching.links ?? []).flatMap((l) => (l[0] === 'survey' ? [/** @type {LinkSpec} */ (['survey', 'wait']), /** @type {LinkSpec} */ (['wait', 's1'])] : [l])),
};

/**
 * Root > New Tree > 2 regions > exams > programs, with one empty and one protected exam.
 * @param {ProgramSpec[]} head the programs of the first exam
 * @returns {ExarSpec}
 */
const tree = (head) => ({
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
            { label: 'Head Routine', programs: head },
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
});

export const defaultSpec = tree([linear, branching, brokenLink]);

/** `defaultSpec` with the Axial T2 program edited (see `branchingEdited`). */
export const variantSpec = tree([linear, branchingEdited, brokenLink]);

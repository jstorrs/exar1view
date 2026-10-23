// @ts-check
/**
 * Compact description of a synthetic exar1 (all names are invented).
 * A label is a string (English text) or a language -> text map.
 *
 * @typedef {string | Record<string, string>} Label
 * @typedef {{ label: Label, comment?: string, tags?: Record<string, string> }} ProgramSpec
 * @typedef {{
 *   label: Label, comment?: string, isProtected?: boolean, password?: string,
 *   dirs?: DirSpec[], programs?: ProgramSpec[],
 * }} DirSpec
 * @typedef {{ baseline: string, root: DirSpec }} ExarSpec
 */

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
            {
              label: 'Head Routine',
              programs: [
                { label: 'Localizer', tags: { Archive: 'True' } },
                { label: 'Axial T2', comment: 'Check the coil', tags: { SystemConfiguration: '021 / XR', Archive: 'True' } },
                { label: 'Sagittal T1' },
              ],
            },
            { label: 'Empty Exam' },
          ],
        },
        {
          label: 'Ortho',
          dirs: [
            { label: { de: 'Kniegelenk' }, programs: [{ label: 'Knee PD' }] },
            { label: 'Locked Exam', isProtected: true, password: 'SECRET-PW', programs: [{ label: 'Shoulder Survey' }] },
          ],
        },
      ],
    }],
  },
};

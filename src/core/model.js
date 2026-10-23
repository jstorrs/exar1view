// @ts-check
/**
 * Data model that the loading steps fill and the UI reads. Typedefs only.
 *
 * Keys are strings prefixed by the owning file's id so that several files can be open at once:
 *   file id            f1, f2, ...
 *   region/exam keys   f1:r:<guid>, f1:e:<guid>
 *   program key        f1:p:<guid>      (element guid)
 *   step key           f1:s:<guid>      (step element guid)
 * Directory passwords never appear anywhere in the model.
 */

/** @typedef {{ level: 'error' | 'warning', where: string, message: string }} Problem */

/** @typedef {{ files: ExarFile[] }} Workspace */

/**
 * @typedef {object} ExarFile
 * @property {string} id
 * @property {string} name
 * @property {number} size
 * @property {string} baseline
 * @property {{ id: string, dateTime: string, comment: string }} changeset
 * @property {Region[]} regions
 * @property {Problem[]} problems
 */

/** @typedef {{ key: string, label: string, exams: Exam[] }} Region */
/** @typedef {{ key: string, label: string, programs: Program[] }} Exam */

/**
 * @typedef {object} Program
 * @property {string} key
 * @property {{ element: string, object: string }} ids
 * @property {string} label
 * @property {string | null} comment
 * @property {Record<string, string>} tags
 * @property {string[]} path
 * @property {BodyNode[]} body
 * @property {Condition[]} conditions
 * @property {CopyRef[]} copyRefs
 * @property {'links' | 'rank'} order
 * @property {Problem[]} problems
 */

/**
 * @typedef {{ type: 'step', step: Step }
 *   | { type: 'fork', split: Step, join: Step, condition: Condition, branches: Branch[] }} BodyNode
 */

/** @typedef {{ choice: Choice, isDefault: boolean, body: BodyNode[] }} Branch */
/** @typedef {{ objectId: string, label: string }} Choice */

/**
 * @typedef {object} Condition
 * @property {string} id
 * @property {'Strategy' | 'Decision' | 'Other'} kind
 * @property {string} label
 * @property {string | null} description
 * @property {Choice[]} choices
 * @property {string | null} defaultChoice
 */

/** @typedef {'Measurement' | 'Pause' | 'Interaction' | 'Decision' | 'Workflow' | 'Split' | 'Join'} StepKind */

/**
 * @typedef {object} StepBase
 * @property {string} key
 * @property {{ element: string, instance: string, object: string }} ids
 * @property {string} label
 * @property {string | null} comment
 * @property {Record<string, string>} tags
 * @property {number | null} rank
 * @property {Problem[]} problems
 */

/**
 * A step; `kind` discriminates `detail`.
 * @typedef {StepBase & (
 *   { kind: 'Measurement', detail: MeasurementDetail }
 *   | { kind: 'Pause', detail: PauseDetail }
 *   | { kind: 'Interaction', detail: InteractionDetail }
 *   | { kind: 'Decision', detail: DecisionDetail }
 *   | { kind: 'Workflow', detail: WorkflowDetail }
 *   | { kind: 'Split' | 'Join', detail: SplitJoinDetail }
 * )} Step
 */

/**
 * @typedef {{ protocolBlob: string | null, protocolHash: string | null, addInBlob: string | null,
 *   bodyPart: string | null, laterality: string | null, imageComment: string | null,
 *   openBeforeStart: boolean | null }} MeasurementDetail
 */
/** @typedef {{ applyContrastAgent: boolean | null, contrastAgentName: string | null, contrastAgent: string | null }} PauseDetail */
/** @typedef {{ addInBlob: string | null, openBeforeStart: boolean | null }} InteractionDetail */
/** @typedef {{ addInBlob: string | null }} WorkflowDetail */
/** @typedef {{ conditionId: string | null, addInBlob: string | null, openBeforeStart: boolean | null }} DecisionDetail */
/** @typedef {{ conditionId: string | null }} SplitJoinDetail */

/** @typedef {MeasurementDetail | PauseDetail | InteractionDetail | WorkflowDetail | DecisionDetail | SplitJoinDetail} StepDetail */

/**
 * @typedef {object} CopyRef
 * @property {string} source
 * @property {string} target
 * @property {string} group
 * @property {boolean} broken
 * @property {Record<string, boolean>} flags
 */

/**
 * The measurement detail of a step, or null for any other kind.
 * @param {Step} step
 * @returns {MeasurementDetail | null}
 */
export function measurementDetail(step) {
  return step.kind === 'Measurement' ? step.detail : null;
}

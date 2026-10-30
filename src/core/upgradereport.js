// @ts-check
/**
 * The "Upgrade notes" report model: the parameter changes a scanner upgrade recorded in each protocol's
 * conversion notes, grouped by distinct change with the steps they apply to, plus a by-step list.
 * A step whose protocol is missing, unread, or unreadable is a gap, never clean. Pure.
 */
import { displaySteps, measurementDetail } from './model.js';
import { useOf } from './seqreport.js';
import { parseNotes } from './upgradenotes.js';

/** @typedef {import('./model.js').ExarFile} ExarFile */
/** @typedef {import('./seqreport.js').Use} Use */
/** @typedef {import('./seqreport.js').Gap} Gap */
/** @typedef {import('./seqrefs.js').ProtocolRefs} ProtocolRefs */
/** @typedef {import('./upgradenotes.js').Change} Change */
/** @typedef {import('./upgradenotes.js').Conversion} Conversion */
/** @typedef {Use & { sequence: string | null }} NoteUse */
/** @typedef {{ use: NoteUse, conversions: Conversion[] }} StepNotes */
/** @typedef {{ use: NoteUse, dates: (string | null)[] }} ChangeUse */
/** @typedef {{ change: Change, uses: ChangeUse[], programs: number }} ChangeEntry */
/** @typedef {{ parameter: string | null, changes: ChangeEntry[], steps: number, programs: number }} ParameterGroup */
/** @typedef {{ programKey: string, fileId: string, fileName: string, path: string[], steps: StepNotes[] }} ProgramNotes */
/** @typedef {{ byChange: ChangeEntry[], byParameter: ParameterGroup[], byStep: StepNotes[], byProgram: ProgramNotes[], gaps: Gap[], files: number, steps: number, programs: number }} UpgradeReport */
/** @typedef {{ refs: ReadonlyMap<string, ProtocolRefs>, upgrades: ReadonlyMap<string, string> }} UpgradeScan */

/** @param {string} a @param {string} b */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Parsed changes first (parameter, case-insensitive, then text), then non-change lines by text. @param {Change} a @param {Change} b */
const byChangeOrder = (a, b) => {
  if (a.parameter === null || b.parameter === null) {
    return (a.parameter === null ? 1 : 0) - (b.parameter === null ? 1 : 0) || cmp(a.text, b.text);
  }
  return cmp(a.parameter.toLowerCase(), b.parameter.toLowerCase()) || cmp(a.parameter, b.parameter) || cmp(a.text, b.text);
};

/** @param {Iterable<ChangeUse>} uses */
const countPrograms = (uses) => new Set([...uses].map((u) => `${u.use.fileId}\0${u.use.programKey}`)).size;

/**
 * One group per distinct parameter, in byChange order, then one group (parameter null) for the non-change text lines.
 * Grouping is by the exact parameter string, though byChange sorts case-insensitively, so "TE" and "te" stay separate groups.
 * @param {readonly ChangeEntry[]} byChange
 * @returns {ParameterGroup[]}
 */
function groupByParameter(byChange) {
  /** @type {Map<string | null, ChangeEntry[]>} */ const groups = new Map();
  for (const e of byChange) {
    const list = groups.get(e.change.parameter);
    if (list) list.push(e); else groups.set(e.change.parameter, [e]);
  }
  return [...groups].map(([parameter, changes]) => {
    const uses = changes.flatMap((e) => e.uses);
    return {
      parameter, changes, programs: countPrograms(uses),
      steps: new Set(uses.map((u) => `${u.use.fileId}\0${u.use.stepKey}`)).size,
    };
  });
}

/** Programs in tree order, each with its noted steps. @param {readonly StepNotes[]} byStep @returns {ProgramNotes[]} */
function groupByProgram(byStep) {
  /** @type {Map<string, ProgramNotes>} */ const programs = new Map();
  for (const notes of byStep) {
    const { fileId, fileName, programKey, path } = notes.use;
    const id = `${fileId}\0${programKey}`;
    let entry = programs.get(id);
    if (!entry) { entry = { programKey, fileId, fileName, path: path.slice(0, -1), steps: [] }; programs.set(id, entry); }
    entry.steps.push(notes);
  }
  return [...programs.values()];
}

/**
 * @param {readonly ExarFile[]} files
 * @param {ReadonlyMap<string, UpgradeScan>} scans fileId -> that file's refs and upgrade notes per protocol blob
 * @returns {UpgradeReport}
 */
export function buildUpgradeReport(files, scans) {
  /** @type {Map<string, Conversion[]>} */ const parsed = new Map();
  /** @type {Map<string, ChangeEntry>} */ const changes = new Map();
  /** @type {StepNotes[]} */ const byStep = [];
  /** @type {Gap[]} */ const gaps = [];
  let steps = 0;

  for (const file of files) {
    const scan = scans.get(file.id);
    for (const region of file.regions) for (const exam of region.exams) for (const program of exam.programs) {
      for (const step of displaySteps(program.body)) {
        const detail = measurementDetail(step);
        if (!detail) continue;
        steps++;
        const use = useOf(file, region, exam, program, step);
        const blob = detail.protocolBlob || null;
        const result = blob === null ? null : scan?.refs.get(blob);
        if (blob === null) gaps.push({ reason: 'no-protocol', error: null, use });
        else if (!result) gaps.push({ reason: 'not-read', error: null, use });
        else if (!result.ok) gaps.push({ reason: 'unreadable', error: result.error, use });
        else {
          const text = scan?.upgrades.get(blob);
          if (typeof text !== 'string') continue;
          let conversions = parsed.get(text);
          if (!conversions) { conversions = parseNotes(text); parsed.set(text, conversions); }
          /** @type {NoteUse} */
          const noteUse = { ...use, sequence: result.refs.find((r) => r.key === 'tSequenceFileName')?.value ?? null };
          byStep.push({ use: noteUse, conversions });
          /** @type {Map<string, ChangeUse>} */ const here = new Map();
          for (const conversion of conversions) for (const change of conversion.changes) {
            let entry = changes.get(change.text);
            if (!entry) { entry = { change, uses: [], programs: 0 }; changes.set(change.text, entry); }
            let changeUse = here.get(change.text);
            if (!changeUse) { changeUse = { use: noteUse, dates: [] }; here.set(change.text, changeUse); entry.uses.push(changeUse); }
            changeUse.dates.push(conversion.date);
          }
        }
      }
    }
  }

  const byChange = [...changes.values()].sort((a, b) => byChangeOrder(a.change, b.change));
  for (const e of byChange) e.programs = countPrograms(e.uses);
  const programs = new Set(byStep.map((s) => `${s.use.fileId}\0${s.use.programKey}`)).size;
  return { byChange, byParameter: groupByParameter(byChange), byStep, byProgram: groupByProgram(byStep), gaps, files: files.length, steps, programs };
}

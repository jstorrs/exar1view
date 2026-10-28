// @ts-check
/**
 * Lays one sub-protocol's Preview items (plus the controller items) out as the display groups
 * of the Summary tab: labelled, valued as text, hidden keys dropped. Pure.
 */
import { codePattern } from './preview.js';

/** @typedef {import('./preview.js').PreviewItem} PreviewItem */
/** @typedef {import('./preview.js').SubSummary} SubSummary */
/** `raw`: the stored value as a string, for the hover. @typedef {{ key: string, label: string, text: string, raw: string }} SummaryItem */
/** @typedef {{ title: string, items: SummaryItem[] }} SummaryGroup */

const M = 'sub.#.msr.';
const C = 'ctrl.Properties.';

/** Groups in display order; within a group, items follow the order of `patterns` (key patterns, indices as `#`). Anything unlisted goes to Other. */
const GROUPS = [
  { title: 'Contrast & timing', patterns: [`${M}time`, `${M}tr.#`, `${M}te.#`, `${M}angle_array.#`, `${M}seq_subpath`, `${M}mag_field_strength`] },
  { title: 'Geometry', patterns: [`${M}total_size`, `${M}sg.#.size`, `${M}sl_thick`, `${M}sg.#.df`, `${M}readout_fov`, `${M}phase_fov`, `${M}matrix`, `${M}sg.#.ori2`, `${M}sg.#.pe_dir`] },
  {
    title: 'Options',
    patterns: [
      `${M}fat_sat`, `${M}h2o_sat`, `${M}aa_derived_para`, 'ctrl.MultiStep.IsMultistep', `${C}Queue.WaitForUserToStart.#`,
      `${C}AutoLoad.AutoStore`, `${C}AutoLoad.LoadToViewer`, `${C}AutoLoad.LoadToGraphic`, 'sub.#.IRIS.PIPE.PostProc.Subtraction.EXECUTE', `${C}Queue.WaitForStartChoice`,
    ],
  },
];
const OTHER = 'Other';

/** Label and unit for keys whose Preview Label or Unit is blank. @type {Record<string, { label: string, unit?: string }>} */
const FALLBACK = {
  [`${M}mag_field_strength`]: { label: 'Field', unit: 'T' },
};

/** @param {string} pattern */
const hidden = (pattern) =>
  [`${M}time_sec`, `${M}aa_is_scout`, 'sub.#.HEADER.SubProtocolCount', 'ctrl.MultiStep.IsMultiStepReadOnly'].includes(pattern) ||
  pattern.includes('.PerformanceCache.');

/** @param {PreviewItem} item @param {string} unit */
function valueText({ value }, unit) {
  const withUnit = (/** @type {string} */ s) => (unit === '' ? s : `${s} ${unit}`);
  switch (value.kind) {
    case 'number': return withUnit(String(value.value));
    case 'text': return withUnit(value.value);
    case 'bool': return value.value ? 'on' : 'off';
    case 'code': return value.text ?? `code ${value.code}`;
  }
}

/** @param {PreviewItem} item @returns {string} */
function rawText({ value }) {
  return value.kind === 'code' ? String(value.code) : String(value.value);
}

/**
 * @param {SubSummary} sub
 * @param {PreviewItem[]} controller
 * @returns {SummaryGroup[]}
 */
export function summaryGroups(sub, controller) {
  /** @type {SummaryGroup[]} */
  const out = [...GROUPS.map(({ title }) => title), OTHER].map((title) => ({ title, items: [] }));
  const ranked = [...sub.items, ...controller]
    .map((item) => ({ item, pattern: codePattern(item.key) }))
    .filter(({ pattern }) => !hidden(pattern))
    .map((e) => {
      const g = GROUPS.findIndex(({ patterns }) => patterns.includes(e.pattern));
      return { ...e, group: g < 0 ? GROUPS.length : g, rank: g < 0 ? 0 : GROUPS[g].patterns.indexOf(e.pattern) };
    })
    .sort((a, b) => a.group - b.group || a.rank - b.rank || a.item.key.localeCompare(b.item.key, 'en', { numeric: true }));
  for (const { item, pattern, group } of ranked) {
    const fb = FALLBACK[pattern];
    const label = item.label.trim() !== '' ? item.label : (fb?.label ?? item.key);
    const unit = item.unit !== '' ? item.unit : (fb?.unit ?? '');
    out[group].items.push({ key: item.key, label, text: valueText(item, unit), raw: rawText(item) });
  }
  return out.filter((g) => g.items.length > 0);
}

// @ts-check
/**
 * The sequence report and the upgrade notes report as rows for a spreadsheet (upgrade-planning
 * documents): one row per (reference, use) or per (step, conversion, change), then one per step
 * that was not checked. Pure; the CSV and tab-separated writers guard against formula injection
 * (OWASP): a field starting with = + - @ tab or CR gets a leading apostrophe, unless it is a plain
 * number such as -10 (which cannot be a formula). Text is raw, not made visible.
 */
import { CATEGORY_LABEL } from './seqrefs.js';
import { GAP_LABEL } from './seqreport.js';

/** @typedef {import('./seqreport.js').SequenceReport} SequenceReport */
/** @typedef {import('./seqreport.js').Use} Use */
/** @typedef {import('./upgradereport.js').UpgradeReport} UpgradeReport */

/** @param {Use} u */
const where = (u) => [u.fileName, ...u.path];

/**
 * @param {SequenceReport} report
 * @returns {string[][]} the header row, then reference rows in report order, then gap rows
 */
export function reportRows(report) {
  return [
    ['Category', 'Placeholder', 'Parameter', 'Reference', 'File', 'Region', 'Exam', 'Program', 'Step'],
    ...report.byReference.flatMap((g) => g.entries.flatMap((e) => e.uses.map((u) =>
      [CATEGORY_LABEL[e.category], e.ref.placeholder ?? '', e.ref.key, e.ref.value, ...where(u)]))),
    ...report.gaps.map((g) => ['Not checked', '', '', GAP_LABEL[g.reason] + (g.error === null ? '' : `: ${g.error}`), ...where(g.use)]),
  ];
}

/**
 * @param {UpgradeReport} report
 * @returns {string[][]} the header row, then each step's conversions' changes in tree order, then gap rows
 */
export function upgradeRows(report) {
  return [
    ['Category', 'Parameter', 'From', 'To', 'Unit', 'Text', 'Converted', 'File', 'Region', 'Exam', 'Program', 'Step', 'Sequence'],
    ...report.byStep.flatMap(({ use, conversions }) => conversions.flatMap((c) => {
      const tail = [c.date ?? '', ...where(use), use.sequence ?? ''];
      return c.changes.length === 0
        ? [['No changes listed', '', '', '', '', '', ...tail]]
        : c.changes.map((ch) => ch.parameter === null
          ? ['Note text', '', '', '', '', ch.text, ...tail]
          : ['Change', ch.parameter, ch.from, ch.to, ch.unit, '', ...tail]);
    })),
    ...report.gaps.map((g) => ['Not checked', '', '', '', '', GAP_LABEL[g.reason] + (g.error === null ? '' : `: ${g.error}`), '', ...where(g.use), '']),
  ];
}

/** @param {string} field */
const guard = (field) => (/^[=+\-@\t\r]/.test(field) && !/^[-+]?\d+(?:\.\d+)?$/.test(field) ? `'${field}` : field);

/** RFC 4180, CRLF line ends. @param {readonly (readonly string[])[]} rows */
export function toCsv(rows) {
  const quote = (/** @type {string} */ f) => (/[",\r\n]/.test(f) ? `"${f.replaceAll('"', '""')}"` : f);
  return rows.map((r) => r.map((f) => quote(guard(f))).join(',')).join('\r\n') + '\r\n';
}

/** Tab-separated, LF line ends; tabs and line breaks inside a field become a space. @param {readonly (readonly string[])[]} rows */
export function toTsv(rows) {
  return rows.map((r) => r.map((f) => guard(f).replace(/[\t\r\n]/g, ' ')).join('\t')).join('\n') + '\n';
}

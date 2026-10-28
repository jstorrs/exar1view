// @ts-check
/**
 * The hand-written card formulas a catalog rule names (`{kind: "formula", name}`). Pure.
 *
 * A formula gets the protocol's sources, the group index (null outside a grouped slot) and the
 * rule's variant for the protocol's sequence (null when it has none). It returns the value text,
 * `{label, text}` for a slot whose label it computes (`@…` ids), or null when it does not apply.
 */

import { sourceNumber, sourceValue } from './cardsource.js';
import { fixed } from './numfmt.js';
import { AXIS_LETTERS, DIRECTIONS, directionText, isOblique, mainAxis, orientation, orientationText, phaseRead, positionText } from './cardgeometry.js';

/** @typedef {import('./cardsource.js').CardSources} CardSources */
/** @typedef {(src: CardSources, group: number | null, variant: string | null) => string | { label: string, text: string } | null} CardFormula */

/** @typedef {import('./cardgeometry.js').Vec3} Vec3 */
/**
 * What a geometry line describes: a slice or slab group, a navigator, a saturation region, a
 * graphical inversion slab (one of a group kind, by group index), the adjust volume, the
 * spectroscopy VoI, or the AutoAlign initial slice.
 * @typedef {'slice' | 'slab' | 'navigator' | 'satregion' | 'inversion' | 'adj' | 'voi' | 'aa'} PlacedKind
 */
/**
 * An object's placement: `center` as printed (with the table offset where the print adds it),
 * `normal` never zero, in-plane `rotation` in radians, `iso` when the stored center is exactly 0.
 * @typedef {{ center: Vec3, normal: Vec3, rotation: number, iso: boolean }} Placement
 */

/** @param {CardSources} src @param {string} key @param {number} dflt */
const num = (src, key, dflt) => sourceNumber(src, key) ?? dflt;

/** The kinds with a full set of geometry formulas (the VoI has a position formula only). */
const PLACED_KINDS = /** @type {const} */ (['slice', 'slab', 'navigator', 'satregion', 'inversion', 'adj', 'aa']);
const DEG = 180 / Math.PI;
/** More slices than a protocol can hold: a bound on `sSliceArray.lSize`. */
const MAX_SLICES = 4096;

/** @param {CardSources} src @param {string} prefix `….sPosition` or `….sNormal` @returns {Vec3} */
const vec = (src, prefix) => [num(src, `${prefix}.dSag`, 0), num(src, `${prefix}.dCor`, 0), num(src, `${prefix}.dTra`, 0)];

/** The slice indices of slice group `g`. @param {CardSources} src @param {number} g */
function groupSlices(src, g) {
  const n = Math.min(MAX_SLICES, Math.trunc(num(src, 'sSliceArray.lSize', 1)));
  const members = Array.from({ length: Math.max(0, n) }, (_, i) => Math.trunc(num(src, `sGroupArray.anMember[${i}]`, 0)));
  const low = Math.trunc(num(src, `sGroupArray.asGroup[${g}].nLow`, 0));
  return members.slice(low, low + Math.trunc(num(src, `sGroupArray.asGroup[${g}].nSize`, 1)));
}

/**
 * The adjust volume's mode: 'explicit' (`uiAdjVolumeValid` set: the stored `sAdjVolume`), 'box'
 * (B0 shim mode Tune up: the default box at the isocenter), else 'coupled' (it follows the
 * spectroscopy VoI, or slice group 1).
 * @param {CardSources} src
 */
function adjMode(src) {
  const valid = sourceValue(src, 'sAdjData.uiAdjVolumeValid');
  if (valid !== null && valid !== '0x0' && valid !== '0') return 'explicit';
  return (sourceValue(src, 'sAdjData.uiAdjShimMode') ?? '1') === '1' ? 'box' : 'coupled';
}

/** Whether the protocol has a spectroscopy volume of interest. @param {CardSources} src */
const hasVoi = (src) => sourceValue(src, 'sSpecPara.sVoI.dThickness') !== null;

/** A stored cuboid: position, normal and in-plane rotation under `p`. @param {CardSources} src @param {string} p */
const cuboid = (src, p) => ({ center: vec(src, `${p}.sPosition`), normal: vec(src, `${p}.sNormal`), rotation: num(src, `${p}.dInPlaneRot`, 0) });

/**
 * The stored placement of object `kind`, and whether the print adds the table offset to it.
 * @param {CardSources} src @param {PlacedKind} kind @param {number} group
 * @returns {{ center: Vec3, normal: Vec3, rotation: number, offset: boolean } | null}
 */
function stored(src, kind, group) {
  switch (kind) {
    case 'adj': {
      const mode = adjMode(src);
      if (mode === 'box') return { center: [0, 0, 0], normal: [0, 0, 1], rotation: 0, offset: false };
      if (mode === 'explicit') return { ...cuboid(src, 'sAdjData.sAdjVolume'), offset: true };
      return stored(src, 'voi', 0) ?? stored(src, 'slice', 0);
    }
    case 'voi': return hasVoi(src) ? { ...cuboid(src, 'sSpecPara.sVoI'), offset: true } : null;
    case 'aa': return { ...cuboid(src, 'sAAInitialOffset.SliceInformation'), offset: false };
    case 'navigator': return { ...cuboid(src, `sNavigatorArray.asElm[${group}].sCuboid`), offset: true };
    case 'satregion':
    case 'inversion': {
      const p = `${kind === 'satregion' ? 'sRSatArray' : 'sInversionArray'}.asElm[${group}]`;
      return { center: vec(src, `${p}.sPosition`), normal: vec(src, `${p}.sNormal`), rotation: 0, offset: true };
    }
    case 'slice':
    case 'slab': {
      const slices = groupSlices(src, group);
      if (!slices.length) return null;
      const sum = slices.map((i) => vec(src, `sSliceArray.asSlice[${i}].sPosition`)).reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]]);
      const first = cuboid(src, `sSliceArray.asSlice[${slices[0]}]`);
      return { ...first, center: [sum[0] / slices.length, sum[1] / slices.length, sum[2] / slices.length], offset: true };
    }
  }
}

/**
 * Where object `kind` (number `group` of a group kind) is; null when the protocol has no such
 * slice group, or a group kind gets no group index.
 * @param {CardSources} src @param {PlacedKind} kind @param {number | null} group
 * @returns {Placement | null}
 */
function placement(src, kind, group) {
  if (group === null && kind !== 'adj' && kind !== 'voi' && kind !== 'aa') return null;
  const s = stored(src, kind, group ?? 0);
  if (s === null) return null;
  const c = s.center;
  return {
    center: s.offset ? [c[0], c[1], c[2] + num(src, 'lScanRegionPosTra', 0)] : c,
    normal: s.normal.every((x) => x === 0) ? [0, 0, 1] : s.normal,
    rotation: s.rotation,
    iso: c.every((x) => Math.abs(x) < 1e-9),
  };
}

/** A position line: "Isocenter" only when the stored center is exactly 0. @param {Placement} p */
const positionMm = (p) => (p.iso ? 'Isocenter ' : `${positionText(p.center)} mm`);

/** @param {PlacedKind} kind @param {(p: Placement) => string} f @returns {CardFormula} */
const placed = (kind, f) => (src, group) => {
  const p = placement(src, kind, group);
  return p && f(p);
};

/**
 * The AutoAlign initial position along `axis`: the label is the direction letter of the position
 * with the table offset, the value the stored distance (variant `dN`: N decimals, default 1).
 * @param {0 | 1 | 2} axis @returns {CardFormula}
 */
const aaAxis = (axis) => (src, _group, variant) => {
  const c = vec(src, 'sAAInitialOffset.SliceInformation.sPosition');
  const x = axis === 2 ? c[2] + num(src, 'lScanRegionPosTra', 0) : c[axis];
  const d = /^d\d$/.test(variant ?? '') ? Number(variant?.slice(1)) : 1;
  return { label: DIRECTIONS[axis][x >= 0 ? 1 : 0], text: `${fixed(Math.abs(c[axis]), d)} mm` };
};

/**
 * An AutoAlign initial-orientation angle line, printed when that orientation is oblique: the
 * second angle labelled "T > C", the third labelled "> S".
 * @param {'a2' | 'a3'} which @returns {CardFormula}
 */
const aaAngle = (which) => (src) => {
  const p = placement(src, 'aa', null);
  const o = p && orientation(p.normal);
  if (!o || !isOblique(o)) return null;
  const label = which === 'a2' ? `${AXIS_LETTERS[o.main]} > ${AXIS_LETTERS[o.second]}` : `> ${AXIS_LETTERS[o.third]}`;
  return { label, text: `${fixed(o[which], 1)} ` };
};

/** The adjust volume's extents in mm: the default box, the stored volume, the VoI, or slice group 1. @param {CardSources} src */
function adjExtent(src) {
  const mode = adjMode(src);
  if (mode === 'box') return { phase: 263, read: 350, slice: 350 };
  const p = mode === 'explicit' ? 'sAdjData.sAdjVolume' : hasVoi(src) ? 'sSpecPara.sVoI' : null;
  if (p !== null) return { phase: num(src, `${p}.dPhaseFOV`, 0), read: num(src, `${p}.dReadoutFOV`, 0), slice: num(src, `${p}.dThickness`, 0) };
  const th = num(src, 'sSliceArray.asSlice[0].dThickness', 0);
  const n = Math.trunc(num(src, 'sGroupArray.asGroup[0].nSize', 1));
  const slice = n * th + (n - 1) * th * num(src, 'sGroupArray.asGroup[0].dDistFact', 0);
  return { phase: num(src, 'sSliceArray.asSlice[0].dPhaseFOV', 0), read: num(src, 'sSliceArray.asSlice[0].dReadoutFOV', 0), slice };
}

/**
 * An adjust-volume extent line, by its position in the card (phase, read, slice): the label names
 * the axis of that direction ("R >> L", "A >> P", "F >> H", whichever way it points), the value
 * the extent (variant `ceil`: rounded up, else to the nearest mm).
 * @param {'phase' | 'read' | 'slice'} which @returns {CardFormula}
 */
const adjExtentLine = (which) => (src, _group, variant) => {
  const p = placement(src, 'adj', null);
  if (!p) return null;
  const v = which === 'slice' ? p.normal : phaseRead(p.normal, p.rotation)[which];
  const n = Math.hypot(...v);
  const [neg, pos] = DIRECTIONS[mainAxis([v[0] / n, v[1] / n, v[2] / n])];
  const x = adjExtent(src)[which];
  return { label: `${neg} >> ${pos}`, text: `${variant === 'ceil' ? Math.ceil(x - 1e-9) : fixed(x, 0)} mm` };
};

/**
 * The readout bandwidth per pixel, 1 / (2 · dwell time · base resolution), as the sequence's UI
 * rounds it: variant `round` (default), `round10`, `floor`, `ceil`, `half_round` (half the value,
 * rounded: the print of some sequences) or `exact6` (6 decimals).
 * @type {CardFormula}
 */
function bandwidth(src, _group, variant) {
  const dwell = sourceNumber(src, 'sRXSPEC.alDwellTime[0]');
  const base = sourceNumber(src, 'sKSpace.lBaseResolution');
  if (!dwell || !base) return null;
  const x = 1e9 / (dwell * base * 2);
  const text = variant === 'round10' ? String(Math.floor(x / 10 + 0.5) * 10)
    : variant === 'floor' ? String(Math.floor(x + 1e-9))
    : variant === 'ceil' ? String(Math.ceil(x - 1e-9))
    : variant === 'half_round' ? String(Math.floor(x / 2 + 0.5))
    : variant === 'exact6' ? fixed(x, 6)
    : String(Math.floor(x + 0.5));
  return `${text} Hz/Px`;
}

/** The active filters, in the print's order: [name, whether active]. @param {CardSources} src @returns {[string, boolean][]} */
function filters(src) {
  const on = (/** @type {string} */ k) => !['0x0', '0', null].includes(sourceValue(src, k));
  const dc = sourceValue(src, 'sDistortionCorrFilter.ucMode');
  return [
    ['Raw filter', on('sRawFilter.ucOn')],
    ['Distortion Corr.(3D)', dc === '4'],
    ['Dynamic Field Corr.', sourceValue(src, 'sDynDistCorrFilter.ucMode') === '2'],
    ['Distortion Corr.(2D)', dc === '2'],
    ['Prescan Normalize', on('sPreScanNormalizeFilter.ucOn')],
    ['Normalize', on('sNormalizeFilter.ucOn')],
    ['Elliptical filter', on('sEllipticalFilter.ucOn')],
    ['Image Filter', on('sImageFilter.ucOn')],
    ['B1 filter', on('sBiFiCFilter.ucOn')],
  ];
}

/**
 * Averages: `lAverages`, or `dAveragesDouble` with 1 decimal when it is fractional; variant `d1`:
 * always 1 decimal.
 * @type {CardFormula}
 */
function averages(src, _group, variant) {
  const d = sourceNumber(src, 'dAveragesDouble');
  const n = Math.trunc(num(src, 'lAverages', 1));
  if (variant === 'd1') return `${fixed(d ?? n, 1)} `;
  return d !== null && Math.abs(d - Math.round(d)) > 1e-9 ? `${fixed(d, 1)} ` : `${n} `;
}

/** @type {ReadonlyMap<string, CardFormula>} */
export const FORMULAS = new Map([
  // The header line of a grouped block: "Slice group" with value "1", "2", ...
  ['group_number', (_src, group) => (group === null ? null : String(group + 1))],
  ...PLACED_KINDS.flatMap((kind) => /** @type {[string, CardFormula][]} */ ([
    [`position:${kind}`, kind === 'aa' ? placed(kind, (p) => (p.iso ? 'Isocenter ' : `${positionText(p.center)} `)) : placed(kind, positionMm)],
    // The AutoAlign initial orientation names the axes only ("T > C", angles on lines of their own).
    [`orientation:${kind}`, placed(kind, (p) => {
      const o = orientation(p.normal);
      return kind === 'aa' && isOblique(o) ? `${orientationText(o, true)}  ` : `${orientationText(o)} `;
    })],
    [`pe_dir:${kind}`, placed(kind, (p) => `${directionText(phaseRead(p.normal, p.rotation).phase)} `)],
    [`rotation:${kind}`, placed(kind, (p) => `${fixed(p.rotation * DEG, 2)} deg`)],
  ])),
  ['aa_axis:x', aaAxis(0)], ['aa_axis:y', aaAxis(1)], ['aa_axis:z', aaAxis(2)],
  ['aa_angle2', aaAngle('a2')], ['aa_angle3', aaAngle('a3')],
  ['position:voi', placed('voi', positionMm)],
  ['adj_extent:phase', adjExtentLine('phase')], ['adj_extent:read', adjExtentLine('read')], ['adj_extent:slice', adjExtentLine('slice')],
  ['bandwidth', bandwidth],
  // "Raw filter, Normalize" or "None".
  ['filter_summary', (src) => `${filters(src).filter(([, active]) => active).map(([name]) => name).join(', ') || 'None'} `],
  ['averages', averages],
  // The table position: its direction ("H" or "F") and its distance in whole mm.
  ['table_dir', (src) => (num(src, 'lScanRegionPosTra', 0) >= 0 ? 'H ' : 'F ')],
  ['table_mm', (src) => `${fixed(Math.abs(num(src, 'lScanRegionPosTra', 0)), 0)} mm`],
  ['coil_string', (src) => {
    const v = sourceValue(src, 'sCoilSelectMeas.sCoilStringForConversion');
    return v === null ? null : `${v.replace(/^"+|"+$/g, '')} `;
  }],
]);

/**
 * The scanner print's header line above the cards, as fields. `ta`: the Preview's time text as
 * it is (no adjustment for the Introduction setting or for triggering). `voxel` ("0.9×0.9×3.0")
 * or `voi` ("20 ×20 ×20") is set, by whether the protocol has a spectroscopy volume. `pat` is
 * the iPAT factor or "Off", null when the print has no PAT field. `sequence` is the sequence file
 * name, not the scanner's short name. `substep`: "1/n" for a protocol with n > 1 ASCCONV blocks.
 * @typedef {{ ta: string | null, pm: string | null, pat: string | null, voxel: string | null, voi: string | null, snr: string, sequence: string, substep: string | null }} CardHeader
 */

const PM = new Map([[1, 'FIX'], [2, 'REF'], [4, 'ISO']]);

/**
 * @param {CardSources} src
 * @param {boolean} showPat whether the print has the PAT field (the "Resolution - iPAT" card is shown)
 * @returns {CardHeader}
 */
export function header(src, showPat) {
  const time = sourceValue(src, 'pv:sub.0.msr.time');
  const ta = time === null ? null : /^"(.*)"$/.exec(time)?.[1] ?? null;
  const pm = PM.get(num(src, 'ucTablePositioningMode', 0)) ?? null;
  const slice = 'sSliceArray.asSlice[0].';
  const isVoi = hasVoi(src);
  const voi = isVoi
    ? ['dPhaseFOV', 'dReadoutFOV', 'dThickness'].map((k) => fixed(num(src, `sSpecPara.sVoI.${k}`, 0), 0)).join(' ×')
    : null;
  const base = num(src, 'sKSpace.lBaseResolution', 1);
  const x = num(src, `${slice}dReadoutFOV`, 0) / base / (num(src, 'sKSpace.uc2DInterpolation', 0) ? 2 : 1);
  const thick = num(src, `${slice}dThickness`, 0);
  const z = num(src, 'sKSpace.ucDimension', 2) === 4 ? thick / num(src, 'sKSpace.lImagesPerSlab', 1) : thick;
  const voxel = isVoi ? null : `${fixed(x, 1)}×${fixed(x, 1)}×${fixed(z, 1)}`;
  const off = num(src, 'sPat.ucPATMode', 1) === 1;
  const factor = num(src, 'sPat.lAccelFactPE', 1) * num(src, 'sPat.lAccelFact3D', 1) * num(src, 'sSliceAcceleration.lMultiBandFactor', 1);
  return {
    ta, pm, pat: showPat ? (off ? 'Off' : String(Math.trunc(factor))) : null, voxel, voi, snr: '1.00',
    sequence: src.seq, substep: src.nBlocks > 1 ? `1/${src.nBlocks}` : null,
  };
}

/**
 * The header line's fields that are set, in the print's order.
 * @param {CardHeader} hd
 * @returns {[string | null, string][]} label (null: none) and value
 */
export function headerFields(hd) {
  /** @type {[string | null, string | null][]} */
  const fields = [
    ['TA', hd.ta], ['PM', hd.pm],
    ['Voxel size', hd.voxel === null ? null : `${hd.voxel} mm`], ['VoI', hd.voi === null ? null : `${hd.voi} mm`],
    ['PAT', hd.pat], ['Rel. SNR', hd.snr], [null, hd.sequence || null], ['Substep', hd.substep],
  ];
  return /** @type {[string | null, string][]} */ (fields.filter(([, v]) => v !== null));
}

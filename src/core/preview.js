// @ts-check
/**
 * A protocol's Preview (the values the scanner shows for it, per sub-protocol and for the
 * controller) with codes decoded to text where known, and its UpgradeInfo notes. Pure.
 */
import { FormatError, errorText } from './errors.js';
import { asObj, str } from './json.js';
import { evaStringTable } from './xprotocol.js';

/** @typedef {import('./json.js').Json} Json */
/**
 * `code`: an int the scanner shows as text; `text` is null when the code is unknown.
 * @typedef {{ kind: 'number', value: number } | { kind: 'bool', value: boolean } | { kind: 'text', value: string }
 *   | { kind: 'code', code: number, text: string | null }} PreviewValue
 */
/** @typedef {{ key: string, label: string, unit: string, value: PreviewValue }} PreviewItem */
/** `ta`: the sub-protocol's acquisition time as shown ("0:44"); `taSec` is the Preview's time_sec as stored: it may differ from `ta` and may be present when `ta` is absent. @typedef {{ index: number, ta: string | null, taSec: number | null, items: PreviewItem[] }} SubSummary */
/**
 * @typedef {{ ok: true, subs: SubSummary[], controller: PreviewItem[], upgrade: string | null }
 *   | { ok: false, error: string }} PreviewResult
 */

/**
 * Scanner vocabulary for the int codes of sequence parameters, by key with indices replaced
 * by `#`.
 * @type {Record<string, Record<number, string>>}
 */
export const PREVIEW_CODES = {
  'sub.#.msr.fat_sat': {
    33: 'Fat sat.',
    34: 'Water excit. normal',
    35: 'None',
    176: 'Water excit. fast',
    469: 'Q-fat sat.',
    6002: 'SPAIR',
  },
  'sub.#.msr.flow_comp.#': {
    301: 'No',
    302: 'Yes',
    303: 'Read',
    304: 'Slice',
    5052: 'Slice/Read',
  },
  'sub.#.msr.sig_mode1': {
    236: 'None',
    237: 'ECG/Trigger',
    239: 'ECG/Retro',
    240: 'Pulse/Trigger',
    242: 'Pulse/Retro',
    243: 'Ext./Trigger',
    245: 'Ext./Retro',
    246: 'Resp./Trigger',
  },
  'sub.#.msr.aa_derived_para': {
    6145: '---',
    6147: 'Head > Basis',
    6148: 'Head > Brain',
    6149: 'Head > IAC',
    6155: 'Knee > Standard',
    6276: 'Head > Temporal lobe',
    6298: 'Head > Orbits',
    6335: 'Shoulder > Para Tra',
  },
  'sub.#.msr.sg.#.pe_dir': {
    140: 'R >> L',
    141: 'L >> R',
    142: 'A >> P',
    143: 'P >> A',
    144: 'F >> H',
    145: 'H >> F',
  },
  'sub.#.msr.sg.#.ori2': {
    146: 'Sagittal',
    147: 'S > T',
    148: 'S > T > C',
    149: 'S > C',
    150: 'S > C > T',
    151: 'Coronal',
    152: 'C > S',
    153: 'C > S > T',
    154: 'C > T',
    155: 'C > T > S',
    156: 'Transversal',
    157: 'T > C',
    158: 'T > C > S',
    159: 'T > S',
    160: 'T > S > C',
  },
  'sub.#.msr.h2o_sat': {
    39: 'None',
  },
  'sub.#.msr.fat_sat_mode': {
    614: 'Weak',
    615: 'Strong',
  },
};

/** 'sub.0.msr.sg.1.ori2' → 'sub.#.msr.sg.#.ori2'. @param {string} key */
export const codePattern = (key) => key.split('.').map((s) => (/^\d+$/.test(s) ? '#' : s)).join('.');

/**
 * @param {string} key
 * @param {Json} v
 * @param {Map<number, string>} strings
 * @returns {PreviewValue}
 */
function previewValue(key, v, strings) {
  if (typeof v === 'boolean') return { kind: 'bool', value: v };
  if (typeof v === 'string') return { kind: 'text', value: v };
  if (typeof v !== 'number') throw new FormatError('Preview entry: "Value" must be a boolean, number or string');
  if (Number.isInteger(v)) {
    const seq = PREVIEW_CODES[codePattern(key)];
    if (seq) return { kind: 'code', code: v, text: Object.hasOwn(seq, v) ? seq[v] : null };
    const text = key.startsWith('ctrl.Properties.') ? strings.get(v) : undefined;
    if (text !== undefined) return { kind: 'code', code: v, text };
  }
  return { kind: 'number', value: v };
}

/**
 * The UpgradeInfo of a decoded protocol document's body: CRLF becomes LF, trimmed; null when
 * empty, whitespace-only, absent or not text.
 * @param {Record<string, Json>} body
 * @returns {string | null}
 */
export function upgradeOf(body) {
  const notes = body.UpgradeInfo;
  if (typeof notes !== 'string') return null;
  const t = notes.replaceAll('\r\n', '\n').trim();
  return t === '' ? null : t;
}

/**
 * The Preview and UpgradeInfo of a decoded EdfProtocolContent document (core/edf.js decodeBytes).
 * `subs` are by index; `controller` holds the `ctrl.*` entries. Errors quote no document text.
 * @param {{ type: string, body: Record<string, Json> }} doc
 * @returns {PreviewResult}
 */
export function previewOf({ type, body }) {
  if (type !== 'EdfProtocolContent') return { ok: false, error: `expected a protocol, found ${type}` };
  try {
    const preview = asObj(body.Preview, 'Preview');
    const strings = evaStringTable(str(body, 'Data', 'protocol'));
    /** @type {Map<number, SubSummary>} */
    const subs = new Map();
    /** @type {PreviewItem[]} */
    const controller = [];
    for (const [key, raw] of Object.entries(preview)) {
      const sub = /^sub\.(\d+)\./.exec(key);
      if (!sub && !key.startsWith('ctrl.')) continue;
      const e = asObj(raw, 'Preview entry');
      const item = { key, label: str(e, 'Label', 'Preview entry'), unit: str(e, 'Unit', 'Preview entry'), value: previewValue(key, e.Value, strings) };
      if (!sub) {
        controller.push(item);
        continue;
      }
      const index = Number(sub[1]);
      let s = subs.get(index);
      if (!s) subs.set(index, (s = { index, ta: null, taSec: null, items: [] }));
      s.items.push(item);
      const field = key.slice(sub[0].length);
      if (field === 'msr.time' && item.value.kind === 'text') s.ta = item.value.value;
      if (field === 'msr.time_sec' && item.value.kind === 'number') s.taSec = item.value.value;
    }
    return { ok: true, subs: [...subs.values()].sort((a, b) => a.index - b.index), controller, upgrade: upgradeOf(body) };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

/**
 * The acquisition time in seconds of a shown TA text: "m:ss", "h:mm:ss" or "4.5 s"; null for anything else.
 * @param {string} text
 * @returns {number | null}
 */
export function parseTa(text) {
  const clock = /^(?:(\d+):)?(\d+):(\d{2})$/.exec(text);
  if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const secs = /^(\d+(?:\.\d+)?) s$/.exec(text);
  return secs ? Number(secs[1]) : null;
}

/** Seconds as shown, rounded to whole ones: "m:ss", or "h:mm:ss" from an hour. @param {number} sec */
export function formatTa(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

/** `sec`: the total in seconds; `without`: how many steps had no time to add. @typedef {{ sec: number, without: number }} ProgramTa */

/**
 * A program's total acquisition time from the summaries of its measurement steps (null: no
 * protocol to read). Per step: sub-protocol 0's time, its parsed TA text when it parses, else
 * its `taSec`, plus the `taSec` of every other sub-protocol (a later sub without one adds
 * nothing; the text of sub 0 is its own time, not the sum). A step whose sub 0 has neither, or
 * whose summary failed, is counted in `without`. The stored `taSec` and the shown text
 * disagree in a few percent of real protocols; the text is what the scanner shows. No
 * adjustment for the Introduction setting or for triggering.
 * @param {readonly (PreviewResult | null)[]} summaries
 * @returns {ProgramTa}
 */
export function programTa(summaries) {
  let sec = 0;
  let without = 0;
  for (const r of summaries) {
    const subs = r?.ok ? r.subs : [];
    const first = subs.find((s) => s.index === 0);
    const rest = subs.filter((s) => s !== first);
    const own = first === undefined ? null : (first.ta === null ? null : parseTa(first.ta)) ?? first.taSec;
    if (own === null) {
      without++;
      continue;
    }
    sec += own + rest.reduce((n, s) => n + (s.taSec ?? 0), 0);
  }
  return { sec, without };
}

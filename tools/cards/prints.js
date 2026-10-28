// @ts-check
/**
 * Offline reader for the scanner's XML prints of the exar1 protocols, and their join to the steps
 * of an exar1. Prints are confidential site data, run to tens of megabytes and are never shipped:
 * this is a tool, not part of the app. Node APIs.
 */
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { decodeXml, parseXml } from '../../src/core/xmltext.js';
import { displaySteps } from '../../src/core/model.js';

/** @typedef {import('../../src/core/model.js').ExarFile} ExarFile */
/** @typedef {import('../../src/core/model.js').Step} Step */
/** @typedef {Extract<import('../../src/core/xmltext.js').XmlNode, { kind: 'element' }>} XmlElement */

/**
 * One printed parameter: its label and value text exactly as printed (trailing spaces kept), and
 * whether the scanner printed it in a group (`GroupId="1"`).
 * @typedef {{ label: string, value: string, grouped: boolean }} PrintParam
 * @typedef {{ name: string, params: PrintParam[] }} PrintCard
 *
 * A printed protocol. `path` is the protocol path split at backslashes, tree first, without the
 * print's trailing " *"; `header` holds the raw text of the path and of the header lines.
 * @typedef {{ path: string[], header: { path: string, lines: string[] }, cards: PrintCard[] }} PrintProtocol
 */

/**
 * Distinct `X.exar1` under `dir` (recursive, by real path) that have a sibling `X.xml`, in a stable order.
 * @param {string} dir
 */
export function findPrintPairs(dir) {
  const seen = new Set();
  /** @type {{ exar1: string, xml: string }[]} */
  const found = [];
  for (const rel of readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()) {
    if (!rel.endsWith('.exar1')) continue;
    const exar1 = join(dir, rel);
    const xml = `${exar1.slice(0, -'.exar1'.length)}.xml`;
    if (!existsSync(xml)) continue;
    let real;
    try {
      real = realpathSync(exar1);
    } catch {
      continue; // dangling symlink
    }
    if (seen.has(real)) continue;
    seen.add(real);
    found.push({ exar1, xml });
  }
  return found;
}

/** @param {import('../../src/core/xmltext.js').XmlNode} n @returns {n is XmlElement} */
const isElement = (n) => n.kind === 'element';
/** @param {XmlElement} el @param {string} name */
const children = (el, name) => el.children.filter(isElement).filter((c) => c.name === name);
/** @param {XmlElement} el @param {string} name */
const child = (el, name) => children(el, name)[0];
/** The decoded text of an element, exactly as written. @param {XmlElement | undefined} el */
const textOf = (el) => (el ? decodeXml(el.children.map((c) => (c.kind === 'text' ? c.text : '')).join('')) : '');
/** @param {XmlElement} el @param {string} name */
const attr = (el, name) => {
  const a = el.attrs.find(([k]) => k === name);
  return a ? decodeXml(a[1]) : null;
};

/**
 * The protocol of one `<Protocol ...>...</Protocol>` element, or null when it lacks its first
 * SubStep or the path in its header.
 * @param {string} text
 * @returns {PrintProtocol | null}
 */
function parseProtocol(text) {
  const root = parseXml(text)?.find(isElement);
  const sub = root && child(root, 'SubStep');
  const info = sub && child(sub, 'ProtHeaderInfo');
  const pathEl = info && child(info, 'HeaderProtPath');
  if (!sub || !info || !pathEl) return null;
  const path = textOf(pathEl);
  const parts = path.replace(/^\\+/, '').split('\\');
  parts.push(parts.pop()?.replace(/ \*$/, '') ?? '');
  return {
    path: parts,
    header: { path, lines: children(info, 'HeaderProperty').map(textOf) },
    cards: children(sub, 'Card').map((card) => ({
      name: attr(card, 'name') ?? '',
      params: children(card, 'ProtParameter').map((p) => ({
        label: textOf(child(p, 'Label')),
        value: textOf(child(p, 'ValueAndUnit')),
        grouped: attr(p, 'GroupId') === '1',
      })),
    })),
  };
}

/**
 * The protocols of a print, in print order. The text is split at `<Protocol ` elements and each is
 * parsed on its own, so a print of tens of megabytes is never one tree.
 * @param {string} xmlText
 * @returns {{ ok: true, protocols: PrintProtocol[] } | { ok: false, error: string }}
 */
export function readPrint(xmlText) {
  const OPEN = '<Protocol ';
  const CLOSE = '</Protocol>';
  /** @type {PrintProtocol[]} */
  const protocols = [];
  for (let at = xmlText.indexOf(OPEN); at >= 0; at = xmlText.indexOf(OPEN, at + OPEN.length)) {
    const end = xmlText.indexOf(CLOSE, at);
    if (end < 0) return { ok: false, error: `protocol ${protocols.length + 1} is not closed` };
    const protocol = parseProtocol(xmlText.slice(at, end + CLOSE.length));
    if (!protocol) return { ok: false, error: `protocol ${protocols.length + 1} has no sub-step path` };
    protocols.push(protocol);
  }
  return { ok: true, protocols };
}

/** The join key; labels cannot hold NUL. @param {string[]} labels @param {number} occurrence */
const keyOf = (labels, occurrence) => `${labels.join('\0')}\0${occurrence}`;

/**
 * Pairs each print protocol with the measurement step it printed: same region, exam, program and
 * step label, the n-th such protocol with the n-th such step (labels repeat within a program). A
 * path that is not tree/region/exam/program/step matches nothing.
 * @param {ExarFile} file
 * @param {PrintProtocol[]} protocols
 * @returns {{ pairs: { step: Step, protocol: PrintProtocol }[], unmatchedSteps: Step[], unmatchedProtocols: PrintProtocol[] }}
 */
export function joinPrint(file, protocols) {
  /** @type {Map<string, Step>} */
  const byKey = new Map();
  /** @type {Step[]} */
  const steps = [];
  /** @param {Map<string, number>} seen @param {string[]} labels */
  const next = (seen, labels) => {
    const k = labels.join('\0');
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n;
  };
  const stepSeen = new Map();
  for (const r of file.regions) for (const e of r.exams) for (const p of e.programs) {
    for (const s of displaySteps(p.body)) {
      if (s.kind !== 'Measurement') continue;
      const labels = [r.label, e.label, p.label, s.label];
      byKey.set(keyOf(labels, next(stepSeen, labels)), s);
      steps.push(s);
    }
  }
  const protocolSeen = new Map();
  /** @type {{ step: Step, protocol: PrintProtocol }[]} */
  const pairs = [];
  /** @type {PrintProtocol[]} */
  const unmatchedProtocols = [];
  const matched = new Set();
  for (const protocol of protocols) {
    if (protocol.path.length !== 5) {
      unmatchedProtocols.push(protocol);
      continue;
    }
    const labels = protocol.path.slice(1);
    const step = byKey.get(keyOf(labels, next(protocolSeen, labels)));
    if (!step) unmatchedProtocols.push(protocol);
    else {
      matched.add(step);
      pairs.push({ step, protocol });
    }
  }
  return { pairs, unmatchedSteps: steps.filter((s) => !matched.has(s)), unmatchedProtocols };
}

// @ts-check
/**
 * XML text laid out for reading (an add-in's Data): one element per line, indented two spaces per
 * level, a short text-only element on one line, whitespace between elements dropped. Text and
 * attribute values are shown decoded (the five predefined entities and numeric character
 * references). Text that is itself XML once decoded (it starts with `<` and parses) is laid out as
 * the element's children, so XML escaped into XML, however many times, comes out as one tree.
 * Comments, CDATA sections, processing instructions and declarations are shown as written. Pure.
 *
 * A run longer than LONG characters (a line of text, comment or CDATA, or an attribute value; in
 * practice an embedded base64 blob) is cut to its first KEPT characters and a note of its length,
 * so one value cannot make the whole view as wide as itself.
 *
 * Never throws: text that does not parse is shown as it is (the whole input, or a decoded text
 * that is not XML after all), and so is anything nested deeper than the limits below.
 */

/**
 * An element; text (as written, not decoded); or a comment, CDATA section, processing instruction
 * or declaration, as written.
 * @typedef {{ kind: 'element', name: string, attrs: [string, string][], selfClosing: boolean, children: XmlNode[] }
 *   | { kind: 'text', text: string }
 *   | { kind: 'raw', text: string }} XmlNode
 */

/** Deepest element nesting within one text; deeper text is not laid out. */
const MAX_DEPTH = 100;
/** Most levels of XML escaped into XML that are unwrapped; deeper text is shown decoded once more. */
const MAX_LEVELS = 8;
/** Longest text kept on its element's line. */
const LEAF = 100;
/** Longest run shown whole, and how much of a longer one is kept. */
const LONG = 1000;
const KEPT = 120;
const INDENT = '  ';

const NAME = '[\\p{L}_:][\\p{L}\\p{N}_.:\\-\\u00b7]*';
const ATTR = `(${NAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`;
const OPEN = new RegExp(`<(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>`, 'uy');
const ATTRS = new RegExp(ATTR, 'gu');
const CLOSE = new RegExp(`</(${NAME})\\s*>`, 'uy');
const REFERENCE = /&(?:#x([0-9A-Fa-f]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/g;
/** @type {Record<string, string>} */
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
/**
 * Constructs that are shown as written: start (the comment's spelled so that the bundle, inlined
 * in a script tag, never holds the comment opener), end.
 * @type {[RegExp, string][]}
 */
const RAW = [[/<!-{2}/y, '-->'], [/<!\[CDATA\[/y, ']]>'], [/<\?/y, '?>'], [/<!/y, '>']];

/**
 * `text` with its entity and character references replaced; an unknown entity or a reference to
 * no character stays as written.
 * @param {string} text
 */
export function decodeXml(text) {
  return text.replace(REFERENCE, (m, hex, dec, name) => {
    if (name) return ENTITIES[name];
    const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    return cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
  });
}

/**
 * The nodes of `text`, or null when it is not well-formed: a tag that does not parse, an end tag
 * that closes no open element of its name, an element left open, or nesting past MAX_DEPTH.
 * @param {string} text
 * @returns {XmlNode[] | null}
 */
export function parseXml(text) {
  /** @type {XmlNode[]} */
  const top = [];
  /** Open elements, innermost last. @type {Extract<XmlNode, { kind: 'element' }>[]} */
  const open = [];
  const into = () => (open.length > 0 ? open[open.length - 1].children : top);
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt !== i) {
      const end = lt < 0 ? text.length : lt;
      into().push({ kind: 'text', text: text.slice(i, end) });
      i = end;
      continue;
    }
    const raw = RAW.find(([start]) => {
      start.lastIndex = i;
      return start.test(text);
    });
    if (raw) {
      const [start, close] = raw;
      const end = text.indexOf(close, start.lastIndex);
      if (end < 0) return null;
      into().push({ kind: 'raw', text: text.slice(i, end + close.length) });
      i = end + close.length;
      continue;
    }
    if (text.startsWith('</', i)) {
      CLOSE.lastIndex = i;
      const m = CLOSE.exec(text);
      if (!m || open.length === 0 || open[open.length - 1].name !== m[1]) return null;
      open.pop();
      i = CLOSE.lastIndex;
      continue;
    }
    OPEN.lastIndex = i;
    const m = OPEN.exec(text);
    if (!m) return null;
    /** @type {[string, string][]} */
    const attrs = [...m[2].matchAll(ATTRS)].map((a) => [a[1], a[2] ?? a[3]]);
    /** @type {Extract<XmlNode, { kind: 'element' }>} */
    const element = { kind: 'element', name: m[1], attrs, selfClosing: m[3] === '/', children: [] };
    into().push(element);
    if (!element.selfClosing) {
      if (open.length >= MAX_DEPTH) return null;
      open.push(element);
    }
    i = OPEN.lastIndex;
  }
  return open.length === 0 ? top : null;
}

/**
 * `text` when at most LONG characters long, else its first KEPT characters (a surrogate pair kept
 * whole) and ` … (12,345 characters)`, its full length.
 * @param {string} text
 */
export function elide(text) {
  if (text.length <= LONG) return text;
  const cut = /[\ud800-\udbff]/.test(text[KEPT - 1]) ? KEPT - 1 : KEPT;
  return `${text.slice(0, cut)} … (${String(text.length).replace(/\B(?=(\d{3})+$)/g, ',')} characters)`;
}

/** @param {XmlNode} n */
const isBlank = (n) => n.kind === 'text' && n.text.trim() === '';

/**
 * The nodes of decoded text that is XML: it starts with `<`, parses, has an element and no other
 * text than whitespace outside its elements. Else null.
 * @param {string} text trimmed
 * @returns {XmlNode[] | null}
 */
export function nestedXml(text) {
  if (!text.startsWith('<')) return null;
  const nodes = parseXml(text);
  if (nodes === null || !nodes.some((n) => n.kind === 'element') || nodes.some((n) => n.kind === 'text' && !isBlank(n))) return null;
  return nodes;
}

/**
 * Lay out `nodes` at `depth` into `out`, one string per line.
 * @param {readonly XmlNode[]} nodes
 * @param {number} depth indent level
 * @param {number} levels how many escaped levels deep these nodes are
 * @param {string[]} out
 */
function layOut(nodes, depth, levels, out) {
  const pad = INDENT.repeat(depth);
  for (const node of nodes) {
    if (node.kind === 'raw') {
      out.push(pad + node.text.split('\n').map(elide).join('\n'));
    } else if (node.kind === 'text') {
      const text = decodeXml(node.text).trim();
      if (text === '') continue;
      const nested = levels < MAX_LEVELS ? nestedXml(text) : null;
      if (nested) layOut(nested, depth, levels + 1, out);
      else for (const line of text.split(/\r?\n/)) out.push(pad + elide(line.trimEnd()));
    } else {
      const start = `${pad}<${node.name}${node.attrs.map(([k, v]) => ` ${k}="${elide(decodeXml(v))}"`).join('')}`;
      const children = node.children.filter((c) => !isBlank(c));
      if (node.selfClosing) {
        out.push(`${start} />`);
      } else if (children.length === 0) {
        out.push(`${start}></${node.name}>`);
      } else {
        const only = children.length === 1 && children[0].kind === 'text' ? decodeXml(children[0].text).trim() : null;
        if (only !== null && only.length <= LEAF && !only.includes('\n') && !(levels < MAX_LEVELS && nestedXml(only))) {
          out.push(`${start}>${only}</${node.name}>`);
        } else {
          out.push(`${start}>`);
          layOut(children, depth + 1, levels, out);
          out.push(`${pad}</${node.name}>`);
        }
      }
    }
  }
}

/**
 * `text` laid out for reading (see the module comment); as it is when it does not parse.
 * @param {string} text
 * @returns {string}
 */
export function formatXml(text) {
  try {
    const nodes = parseXml(text);
    if (nodes === null) return text;
    /** @type {string[]} */
    const out = [];
    layOut(nodes, 0, 0, out);
    return out.join('\n');
  } catch {
    return text;
  }
}

// @ts-check
/**
 * Reading a protocol's XProtocol text (the Data of an EdfProtocolContent). Pure.
 */

const TABLE = '<EVAStringTable>';
const ENTRY = /\s*(\d+)\s+"([^"]*(?:""[^"]*)*)"(?!")/y;

/**
 * The first `<EVAStringTable> { <count> <code> "<text>" ... }` of the text as code → text
 * (`""` inside a string is a quote). No table, or a malformed one, gives an empty map; entries
 * read before the first malformed one are kept.
 * @param {string} dataText
 * @returns {Map<number, string>}
 */
export function evaStringTable(dataText) {
  /** @type {Map<number, string>} */
  const table = new Map();
  const at = dataText.indexOf(TABLE);
  if (at < 0) return table;
  const open = /\s*\{\s*(\d+)/y;
  open.lastIndex = at + TABLE.length;
  const head = open.exec(dataText);
  if (!head) return table;
  const count = Number(head[1]);
  ENTRY.lastIndex = open.lastIndex;
  for (let i = 0; i < count; i++) {
    const m = ENTRY.exec(dataText);
    if (!m) break;
    // A JSON round trip makes a real copy: a slice of dataText would keep all of the big Data alive.
    table.set(Number(m[1]), JSON.parse(JSON.stringify(m[2].replaceAll('""', '"'))));
  }
  return table;
}

/**
 * @typedef {{ kind: 'xprotocol' | 'ascconv', text: string }} Section
 * @typedef {{ name: string | null, values: Map<string, string> }} ParamValues
 * @typedef {{ t: 'val', s: string } | { t: 'blk', items: Node[] } | { t: 'tag', name: string, v: Node | null }} Node
 */

const TOKEN = /<[^<>]*>|\{|\}|"[^"]*(?:""[^"]*)*"|[^\s{}<>"]+/g;
const PARAM_TAG = /^<(Param\w+|PipeService|PipeObject|Pipe|Functor|ParamFunctor|EVAStringTable|Event|Method|Connection|Dependency|ProtocolComposer)(?:\."([^"]*)")?>/;
const SKIPPED = new Set(['Event', 'Method', 'Connection', 'Dependency', 'EVAStringTable']);
const TYPE_DEFAULT = new Map([['ParamBool', 'false'], ['ParamLong', '0'], ['ParamDouble', '0'], ['ParamString', '']]);
const SECTION_START = /<XProtocol>|### ASCCONV BEGIN[^\n]*\n/g;
const ASC_END = '### ASCCONV END';

/**
 * The text's XProtocol and ASCCONV sections in order: an XProtocol section runs from its
 * `<XProtocol>` to the next section start, an ASCCONV section is the text between its BEGIN line
 * and its END line (or the end of the text). Never throws.
 * @param {string} text
 * @returns {Section[]}
 */
export function xprotocolSections(text) {
  /** @type {{ at: number, end: number, kind: Section['kind'] }[]} */
  const starts = [];
  for (const m of text.matchAll(SECTION_START)) {
    starts.push({ at: m.index, end: m.index + m[0].length, kind: m[0].startsWith('<X') ? 'xprotocol' : 'ascconv' });
  }
  return starts.map((s, k) => {
    if (s.kind === 'xprotocol') return { kind: s.kind, text: text.slice(s.at, k + 1 < starts.length ? starts[k + 1].at : text.length) };
    const stop = text.indexOf(ASC_END, s.end);
    return { kind: s.kind, text: text.slice(s.end, stop < 0 ? text.length : stop) };
  });
}

/** @param {string} t */
function unquote(t) {
  return t.startsWith('"') && t.endsWith('"') && t.length >= 2 ? t.slice(1, -1).replaceAll('""', '"') : t;
}

/**
 * Items up to the matching `}` (the token at `i` follows the `{`).
 * @param {string[]} toks
 * @param {number} i
 * @returns {[Node[], number]}
 */
function parseBlock(toks, i) {
  /** @type {Node[]} */
  const items = [];
  while (i < toks.length) {
    const t = toks[i];
    if (t === '}') return [items, i + 1];
    if (t === '{') {
      const [sub, next] = parseBlock(toks, i + 1);
      items.push({ t: 'blk', items: sub });
      i = next;
    } else if (t.startsWith('<')) {
      const [v, next] = parseValue(toks, i + 1);
      items.push({ t: 'tag', name: t, v });
      i = next;
    } else {
      items.push({ t: 'val', s: t });
      i++;
    }
  }
  return [items, i];
}

/**
 * @param {string[]} toks
 * @param {number} i
 * @returns {[Node | null, number]}
 */
function parseValue(toks, i) {
  if (i >= toks.length) return [null, i];
  const t = toks[i];
  if (t === '{') {
    const [items, next] = parseBlock(toks, i + 1);
    return [{ t: 'blk', items }, next];
  }
  if (t.startsWith('<')) {
    const [v, next] = parseValue(toks, i + 1);
    return [{ t: 'tag', name: t, v }, next];
  }
  if (t === '}') return [null, i];
  return [{ t: 'val', s: t }, i + 1];
}

/**
 * A node as plain data: a string, or (for a block) an array of those. Tags inside a block are dropped.
 * @param {Node} n
 * @returns {unknown}
 */
function render(n) {
  if (n.t === 'val') return unquote(n.s);
  if (n.t === 'blk') return n.items.filter((x) => x.t !== 'tag').map(render);
  return null;
}

/** Python `json.dumps` of a rendered block (kept for the rare block-valued parameter). @param {unknown} v @returns {string} */
function dumps(v) {
  if (Array.isArray(v)) return `[${v.map(dumps).join(', ')}]`;
  return JSON.stringify(v).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Walk the items, adding the effective value of every leaf parameter under its dotted path.
 * @param {Node[]} items
 * @param {string} prefix
 * @param {Map<string, string>} out
 */
function flatten(items, prefix, out) {
  for (const it of items) {
    if (it.t !== 'tag') continue;
    const m = PARAM_TAG.exec(it.name);
    if (!m || SKIPPED.has(m[1]) || !it.v || it.v.t !== 'blk') continue;
    const kind = m[1];
    const path = prefix + (prefix && m[2] ? '.' : '') + (m[2] ?? '');
    if (kind !== 'ParamMap' && !kind.startsWith('Pipe') && kind !== 'ParamFunctor') {
      const value = effective(kind, it.v.items);
      if (value !== undefined) out.set(path, value);
    }
    flatten(it.v.items, path, out);
  }
}

/**
 * The first bare value, else the last `<Default>` if it is a plain string, else the type default.
 * @param {string} kind
 * @param {Node[]} items
 * @returns {string | undefined}
 */
function effective(kind, items) {
  const first = items.find((x) => x.t !== 'tag');
  if (first) return first.t === 'val' ? unquote(first.s) : dumps(render(first));
  /** @type {unknown} */
  let dflt;
  for (const x of items) {
    if (x.t === 'tag' && !PARAM_TAG.test(x.name) && x.name === '<Default>') dflt = x.v ? render(x.v) : null;
  }
  return typeof dflt === 'string' ? dflt : TYPE_DEFAULT.get(kind);
}

/**
 * The parameters of one XProtocol section (`<XProtocol> { <Name> … }`) as flattened dotted path →
 * effective value. A path joins `ParamMap`/`PipeService`/`ParamFunctor` names with `.` (an empty name
 * adds no segment). Only leaf parameters get an entry, and a `ParamChoice` with no value and no
 * `<Default>` gets none. Lenient: anything unreadable gives fewer entries, never an error.
 * The strings are slices of `sectionText`, so they keep it alive: copy them before caching long-term.
 * @param {string} sectionText
 * @returns {ParamValues}
 */
export function paramValues(sectionText) {
  /** @type {Map<string, string>} */
  const values = new Map();
  /** @type {string | null} */
  let name = null;
  try {
    const toks = sectionText.match(TOKEN) ?? [];
    if (toks[0] !== '<XProtocol>') return { name, values };
    const [root] = parseValue(toks, 1);
    if (root?.t !== 'blk') return { name, values };
    for (const it of root.items) {
      if (it.t === 'tag' && it.name === '<Name>' && it.v) {
        const r = render(it.v);
        name = typeof r === 'string' ? r : null;
      }
    }
    flatten(root.items, '', values);
  } catch {
    // Pathological nesting: keep what was read.
  }
  return { name, values };
}

/**
 * The "MultiStep Controller" section's values (`ctrl:` keys) and the values of the XProtocol section
 * just before ASCCONV block 0 (`eva:` keys); empty maps when absent.
 * @param {string} text
 * @returns {{ controller: Map<string, string>, eva: Map<string, string> }}
 */
export function controllerAndEva(text) {
  /** @type {Map<string, string>} */
  let controller = new Map();
  /** @type {Map<string, string>} */
  let eva = new Map();
  /** @type {Map<string, string> | null} */
  let last = null;
  let seenAsc = false;
  for (const s of xprotocolSections(text)) {
    if (s.kind === 'xprotocol') {
      const { name, values } = paramValues(s.text);
      if (name === 'MultiStep Controller') controller = values;
      else last = values;
    } else {
      if (!seenAsc && last) eva = last;
      seenAsc = true;
      last = null;
    }
  }
  return { controller, eva };
}

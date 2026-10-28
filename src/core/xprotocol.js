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

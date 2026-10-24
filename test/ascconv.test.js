// Ported from protocols tests/test_ascconv.py; the parser here is lenient, so the Python error
// cases become warnings with a sensible result, except text without any block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAscconv, strip } from '../src/core/ascconv.js';

const BEGIN = '### ASCCONV BEGIN object=MrProtDataImpl@MrProtocolData version=51130001 ###';
const END = '### ASCCONV END ###';

const block = (...lines) => [BEGIN, ...lines, END].join('\n');

/** Blocks as plain objects, and the warnings. */
function parse(text) {
  const r = parseAscconv(text);
  assert.ok(r.ok, r.ok ? '' : r.error);
  return { blocks: r.blocks.map((b) => Object.fromEntries(b)), warnings: r.warnings };
}

const clean = (text) => {
  const { blocks, warnings } = parse(text);
  assert.deepEqual(warnings, []);
  return blocks;
};

test('single block', () => {
  const text = `<XProtocol>\n${block('a\t = \t1', 'b.c[0]\t = \t"x"')}\n</XProtocol>`;
  assert.deepEqual(clean(text), [{ a: '1', 'b.c[0]': '"x"' }]);
});

test('two blocks in order', () => {
  assert.deepEqual(clean(`${block('a = 1')}\nxml\n${block('a = 2')}\n`), [{ a: '1' }, { a: '2' }]);
});

test('key order is text order', () => {
  const [b] = parseAscconv(block('z = 1', 'a = 2', 'm = 3')).blocks;
  assert.deepEqual([...b.keys()], ['z', 'a', 'm']);
});

test('trailing comment stripped', () => {
  assert.deepEqual(clean(block("sFoo\t\t = 0x44    # 'D'")), [{ sFoo: '0x44' }]);
});

test('quoted values', () => {
  const text = block('a = "a#b"', 'b = "x b=50,800"  # note', 'c = ""', 'd = 1\r');
  assert.deepEqual(clean(text), [{ a: '"a#b"', b: '"x b=50,800"', c: '""', d: '1' }]);
});

test('unpadded separator', () => {
  assert.deepEqual(clean(block('a=1', 'b="x"')), [{ a: '1', b: '"x"' }]);
});

test('blank lines and empty block', () => {
  assert.deepEqual(clean(block('', 'a = 1', '  ')), [{ a: '1' }]);
  assert.deepEqual(clean(block()), [{}]);
});

test('markers must start a line', () => {
  assert.deepEqual(clean(['x ' + BEGIN, BEGIN, 'a = 1', END].join('\n')), [{ a: '1' }]);
  // The indented BEGIN does not count, so the END has none and is ignored: no block at all.
  assert.deepEqual(parseAscconv(`  ${BEGIN}\na = 1\n${END}`), { ok: false, error: 'no ASCCONV block' });
  assert.deepEqual(parseAscconv(`  ${BEGIN}\na = 1\n`), { ok: false, error: 'no ASCCONV block' });
});

test('BEGIN must be followed by a space', () => {
  assert.equal(parseAscconv(`### ASCCONV BEGINNING ###\na = 1\n${END}`).ok, false);
});

test('a marker must end its line', () => {
  assert.equal(parseAscconv(`${BEGIN} x\na = 1\n${END}`).ok, false);
  // A lone CR or a line separator does not end a line, as in the Python parser.
  assert.equal(parseAscconv(`${BEGIN}\ra = 1\n${END}`).ok, false);
  assert.equal(parseAscconv(`${BEGIN}\u2028a = 1\n${END}`).ok, false);
});

test('CRLF', () => {
  assert.deepEqual(clean([BEGIN, 'a = 1', END].join('\r\n')), [{ a: '1' }]);
});

test('no block is an error', () => {
  assert.deepEqual(parseAscconv('<XProtocol/>'), { ok: false, error: 'no ASCCONV block' });
  assert.deepEqual(parseAscconv(''), { ok: false, error: 'no ASCCONV block' });
});

test('BEGIN without END runs to the end of the text', () => {
  assert.deepEqual(parse(`${BEGIN}\na = 1\n`), {
    blocks: [{ a: '1' }],
    warnings: ['ASCCONV block 1 has BEGIN without END; it runs to the end of the text'],
  });
  assert.deepEqual(parse(`${block('a = 1')}\n${BEGIN}\nb = 1\n`).warnings,
    ['ASCCONV block 2 has BEGIN without END; it runs to the end of the text']);
});

test('BEGIN before the previous END ends the previous block there', () => {
  assert.deepEqual(parse(`${BEGIN}\na = 1\n${BEGIN}\nb = 2\n${END}`), {
    blocks: [{ a: '1' }, { b: '2' }],
    warnings: ['ASCCONV block 1 has no END before the next BEGIN; it ends there'],
  });
});

test('END without BEGIN is ignored', () => {
  assert.deepEqual(parse(`${block('a = 1')}\n${END}`), {
    blocks: [{ a: '1' }], warnings: ['ASCCONV END without BEGIN after 1 block(s); ignored'],
  });
  assert.deepEqual(parse(`${END}\n${block('a = 1')}`).warnings, ['ASCCONV END without BEGIN after 0 block(s); ignored']);
});

test('a duplicate key keeps the last value', () => {
  assert.deepEqual(parse(block('a = 1', 'b = 1', 'a = 2')), {
    blocks: [{ a: '2', b: '1' }], warnings: ['ASCCONV block 1, line 3: duplicate key; the last value is kept'],
  });
});

const BAD_KEY = 'expected KEY = VALUE; line skipped';
const BAD_VALUE = 'malformed value; line skipped';

for (const [line, why] of [
  ['novalue', BAD_KEY],
  [' = 1', BAD_KEY],
  ['a b = 1', BAD_KEY],
  ['a#b = 1', BAD_KEY],
  ['"a" = 1', BAD_KEY],
  ['a =', BAD_VALUE],
  ['a = # c', BAD_VALUE],
  ['a = 1 2', BAD_VALUE],
  ['a = 1\t2', BAD_VALUE],
  ['a = 1\u00a02', BAD_VALUE],
  ['a = 1\u200b', BAD_VALUE],
  ['a = x"a#b"', BAD_VALUE],
  ['a==1', BAD_VALUE],
  ['a = "open', BAD_VALUE],
  ['a = "x" y', BAD_VALUE],
]) {
  test(`a bad line is skipped with a warning: ${JSON.stringify(line)}`, () => {
    assert.deepEqual(parse(block('ok = 1', line, 'z = 2')), {
      blocks: [{ ok: '1', z: '2' }], warnings: [`ASCCONV block 1, line 2: ${why}`],
    });
  });
}

test('blank lines count in line numbers, and blocks are numbered from 1', () => {
  assert.deepEqual(parse(`${block('a = 1')}\n${block('', '', 'bad')}`).warnings,
    [`ASCCONV block 2, line 3: ${BAD_KEY}`]);
});

test('messages never quote the text', () => {
  const secret = 'SECRETVALUE';
  const { warnings } = parse(`${END}\n${block(`${secret} ${secret}`, `a = ${secret} x`, `a = "${secret}`, 'a = 1', 'a = 2')}\n${BEGIN}\n${secret}`);
  assert.ok(warnings.length >= 5);
  for (const w of warnings) assert.ok(!w.includes(secret) && !w.includes('a = '), w);
});

test('whitespace is Python str.strip: U+001C-U+001F and U+0085 strip, U+FEFF does not', () => {
  assert.deepEqual(clean(block('\x1ca.b\x1f = 1')), [{ 'a.b': '1' }]);
  assert.deepEqual(clean(block('a = \x851\x85')), [{ a: '1' }]);
  assert.deepEqual(clean(block('a = "x" \x85# c')), [{ a: '"x"' }]);
  assert.deepEqual(strip('\x1c\x85 　x y\u2029'), 'x y');
  assert.equal(strip('﻿x﻿'), '﻿x﻿');
  const r = parse(block('a = 1﻿', '﻿b = 2', 'c = 3'));
  assert.deepEqual(r.blocks, [{ c: '3' }]);
  assert.equal(r.warnings.length, 2);
});

test('markers still match only at line starts, with LF, CRLF or end of text after them', () => {
  assert.deepEqual(clean(`${BEGIN}\r\na = 1\r\n${END}\r\n`), [{ a: '1' }]);
  assert.deepEqual(clean(`x\n${BEGIN}\na = 1\n${END}`), [{ a: '1' }]);
  // A marker after \r, U+2028 or U+2029 (which `^` matches under /m) is not at a line start.
  for (const sep of ['\r', '\u2028', '\u2029']) {
    assert.equal(parseAscconv(`x${sep}${BEGIN}\na = 1\n${END}\n`).ok, false);
  }
  // A marker followed by \u2028 is not a marker: no BEGIN leaves a lone END; no END leaves BEGIN open.
  assert.equal(parseAscconv(`${BEGIN}\u2028\na = 1\n${END}`).ok, false);
  assert.equal(parseAscconv(`${BEGIN}\na = 1\n${END}\u2028`).ok, true);
});

test('a long line of unterminated BEGINs parses in linear time', () => {
  const line = '### ASCCONV BEGIN '.repeat(Math.ceil((2 << 20) / 18));
  const t0 = performance.now();
  assert.equal(parseAscconv(line).ok, false);
  assert.ok(performance.now() - t0 < 1000);
});

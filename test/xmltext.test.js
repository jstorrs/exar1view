// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeXml, elide, formatXml, parseXml } from '../src/core/xmltext.js';

/** XML escaped as text inside XML. @param {string} s */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

test('decodeXml: the five entities and numeric references; unknown or invalid ones stay', () => {
  assert.equal(decodeXml('&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;'), '<a> & "b" \'c\'');
  assert.equal(decodeXml('&#65;&#x42;&#x1F600;'), 'AB\u{1F600}');
  assert.equal(decodeXml('&amp;lt;'), '&lt;');
  assert.equal(decodeXml('&nbsp; &#xD800; &#x110000; &#99999999999; & &amp'), '&nbsp; &#xD800; &#x110000; &#99999999999; & &amp');
});

test('elements are indented by depth; short leaves stay on one line; whitespace between elements goes', () => {
  assert.equal(formatXml('<a>\n   <b>AutoAlignScout</b><c><d>1</d></c>\n</a>'),
    '<a>\n  <b>AutoAlignScout</b>\n  <c>\n    <d>1</d>\n  </c>\n</a>');
});

test('a declaration, comments, processing instructions and CDATA are shown as written', () => {
  assert.equal(formatXml('<?xml version="1.0"?><!DOCTYPE a><a><!-- x < y --><?pi z?><![CDATA[<b>&amp;</b>]]></a>'),
    '<?xml version="1.0"?>\n<!DOCTYPE a>\n<a>\n  <!-- x < y -->\n  <?pi z?>\n  <![CDATA[<b>&amp;</b>]]>\n</a>');
});

test('attributes are shown decoded, with either quote', () => {
  assert.equal(formatXml(`<a x="1 &amp; 2" y='&lt;b&gt;' z = "&quot;q&quot;"/>`), '<a x="1 & 2" y="<b>" z=""q"" />');
});

test('empty and self-closing elements', () => {
  assert.equal(formatXml('<a><b/><c></c><d>  </d><e x="1" /></a>'), '<a>\n  <b />\n  <c></c>\n  <d></d>\n  <e x="1" />\n</a>');
});

test('mixed content: each text and element on its own line', () => {
  assert.equal(formatXml('<p>one <b>two</b> three</p>'), '<p>\n  one\n  <b>two</b>\n  three\n</p>');
});

test('long or multi-line text goes on its own lines', () => {
  const long = 'x'.repeat(150);
  assert.equal(formatXml(`<a>${long}</a>`), `<a>\n  ${long}\n</a>`);
  assert.equal(formatXml('<a>line 1\r\n  line 2  </a>'), '<a>\n  line 1\n    line 2\n</a>');
});

test('escaped XML in text is laid out as children, three levels deep', () => {
  const inner = '<Inner a="1 &amp; 2"><Value>3 &lt; 4</Value></Inner>';
  const middle = `<Configuration Version="2"><Mode>Auto</Mode><Payload>${esc(inner)}</Payload></Configuration>`;
  const text = `<?xml version="1.0" encoding="utf-8"?>\n<AddInDataModel>\n  <Name>Scout</Name>\n  <Settings>${esc(middle)}</Settings>\n</AddInDataModel>`;
  assert.ok(text.includes('&amp;lt;') && text.includes('&amp;amp;'));
  assert.equal(formatXml(text), [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<AddInDataModel>',
    '  <Name>Scout</Name>',
    '  <Settings>',
    '    <Configuration Version="2">',
    '      <Mode>Auto</Mode>',
    '      <Payload>',
    '        <Inner a="1 & 2">',
    '          <Value>3 < 4</Value>',
    '        </Inner>',
    '      </Payload>',
    '    </Configuration>',
    '  </Settings>',
    '</AddInDataModel>',
  ].join('\n'));
});

test('decoded text that only looks like XML stays text', () => {
  assert.equal(formatXml('<a>&lt;5 mm</a>'), '<a><5 mm</a>');
  assert.equal(formatXml('<a>&lt;b&gt;unclosed</a>'), '<a><b>unclosed</a>');
  assert.equal(formatXml('<a>&lt;b/&gt; and text</a>'), '<a><b/> and text</a>');
});

test('malformed input comes back as it is', () => {
  for (const bad of ['<a><b></a></b>', '<a>', '</a>', '<a x=1></a>', '<a><!-- open</a>', '<a', 'plain < text', '<a x="<"/>']) {
    assert.equal(formatXml(bad), bad);
    assert.equal(parseXml(bad), null);
  }
  assert.equal(formatXml(''), '');
  assert.equal(formatXml('just text'), 'just text');
});

test('deep nesting is not laid out, and does not throw', () => {
  const deep = '<a>'.repeat(100000) + '</a>'.repeat(100000);
  assert.equal(formatXml(deep), deep);
  const ok = '<a>'.repeat(50) + '</a>'.repeat(50);
  assert.equal(formatXml(ok).split('\n').length, 99);
});

test('escape levels past the limit are shown as decoded text', () => {
  let text = '<z>1</z>';
  for (let i = 0; i < 30; i++) text = `<l${i}>${esc(text)}</l${i}>`;
  const out = formatXml(text);
  assert.ok(out.startsWith('<l29>\n  <l28>\n'));
  assert.ok(out.includes('&lt;'));
  assert.ok(!out.includes('<z>'));
});

test('a big input lays out in reasonable time', () => {
  const item = `<Item Key="k">${esc('<V a="1">x</V>')}</Item>`;
  const text = `<R>${item.repeat(5000)}</R>`;
  const t0 = performance.now();
  const out = formatXml(text);
  assert.ok(performance.now() - t0 < 2000);
  assert.equal(out.split('\n').length, 2 + 5000 * 3);
});

test('elide: a run over 1000 characters keeps its first 120 and notes its length', () => {
  assert.equal(elide('x'.repeat(1000)), 'x'.repeat(1000));
  assert.equal(elide('x'.repeat(1001)), `${'x'.repeat(120)} … (1,001 characters)`);
  assert.equal(elide('y'.repeat(167123)), `${'y'.repeat(120)} … (167,123 characters)`);
  // A surrogate pair across the cut is kept whole (left out), never split.
  assert.equal(elide(`${'a'.repeat(119)}\u{1F600}${'b'.repeat(1000)}`), `${'a'.repeat(119)} … (1,121 characters)`);
});

test('long text, attribute values, comments and CDATA lines are elided', () => {
  const b64 = 'QUJD'.repeat(500); // 2000 characters
  const cut = `${b64.slice(0, 120)} … (2,000 characters)`;
  assert.equal(formatXml(`<a><Blob>${b64}</Blob></a>`), `<a>\n  <Blob>\n    ${cut}\n  </Blob>\n</a>`);
  assert.equal(formatXml(`<a>text <b/> ${b64}</a>`), `<a>\n  text\n  <b />\n  ${cut}\n</a>`);
  assert.equal(formatXml(`<a x="${b64}" y="1"/>`), `<a x="${cut}" y="1" />`);
  assert.equal(formatXml(`<a><![CDATA[${b64}]]></a>`), `<a>\n  ${elide(`<![CDATA[${b64}]]>`)}\n</a>`);
  const ok = 'Q'.repeat(1000);
  assert.equal(formatXml(`<a><B>${ok}</B></a>`), `<a>\n  <B>\n    ${ok}\n  </B>\n</a>`);
  // Escaped, the blob is elided at the level where it is text.
  assert.equal(formatXml(`<a>${esc(`<B>${b64}</B>`)}</a>`), `<a>\n  <B>\n    ${cut}\n  </B>\n</a>`);
});

test('nesting past the depth limit inside an escaped level comes out as decoded text', () => {
  const deep = '<b>'.repeat(120) + '</b>'.repeat(120);
  assert.equal(formatXml(`<a>${esc(deep)}</a>`), `<a>\n  ${deep}\n</a>`);
});

test('a CDATA section holding escaped XML is shown as written, not unwrapped', () => {
  const cdata = `<![CDATA[${esc('<b>1</b>')}]]>`;
  assert.equal(formatXml(`<a>${cdata}</a>`), `<a>\n  ${cdata}\n</a>`);
});

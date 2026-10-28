// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guidanceOf } from '../src/core/guidance.js';

const KEY = 'i18n://syngo.MR.ApplCommon.Resources.GuidanceResources/Resource/NoticePleaseConfigureGuidanceTextHere';
const FLOW = (/** @type {string} */ body) =>
  `<FlowDocument xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><Section>${body}</Section></FlowDocument>`;
const RTF = (/** @type {string} */ tag, /** @type {string} */ body) =>
  `<${tag} xmlns:a="urn:rt"><a:m_guidingString>${FLOW(body)}</a:m_guidingString></${tag}>`;
const IMG = (/** @type {string} */ tag, /** @type {string} */ b64) =>
  b64 ? `<${tag} xmlns:a="urn:img"><a:m_image>${b64}</a:m_image></${tag}>` : `<${tag} i:nil="true" xmlns:a="urn:img" />`;
const CONFIG = (/** @type {string} */ inner) => `<GuidanceCombiConfig xmlns:i="urn:i"><IsDecisionStep>false</IsDecisionStep>${inner}</GuidanceCombiConfig>`;
const esc = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const model = (/** @type {string} */ configuration) => `<AddInDataModel><Configuration>${configuration}</Configuration></AddInDataModel>`;

test('guidanceOf: paragraphs per block, Run children joined, blank ones dropped', () => {
  const xml = CONFIG(
    RTF('m_rtfAAA', '<Paragraph>First</Paragraph><Paragraph><Run>Sec</Run><Run>ond</Run></Paragraph><Paragraph>  </Paragraph>') +
      RTF('m_rtfBBB', '<Paragraph></Paragraph>') +
      RTF('m_rtfCCC', '<Paragraph>Third</Paragraph>'),
  );
  assert.deepEqual(guidanceOf(model(xml)), { texts: [['First', 'Second'], ['Third']], images: 0, placeholder: false });
});

test('guidanceOf: configuration escaped once or twice is unwrapped', () => {
  const xml = CONFIG(RTF('m_rtfAAA', '<Paragraph>A &amp; B</Paragraph>'));
  for (const data of [model(esc(`<Root>${xml}</Root>`)), model(esc(`<Root>${esc(`<Inner>${xml}</Inner>`)}</Root>`))]) {
    assert.deepEqual(guidanceOf(data)?.texts, [['A & B']]);
  }
});

test('guidanceOf: the FlowDocument itself may be escaped inside m_guidingString', () => {
  const xml = CONFIG(`<m_rtfAAA xmlns:a="urn:rt"><a:m_guidingString>${esc(FLOW('<Paragraph>Hi</Paragraph>'))}</a:m_guidingString></m_rtfAAA>`);
  assert.deepEqual(guidanceOf(model(esc(xml)))?.texts, [['Hi']]);
});

test('guidanceOf: stock placeholder blocks are dropped; placeholder is set when only they were there', () => {
  const only = CONFIG(RTF('m_rtfAAA', `<Paragraph>${KEY}</Paragraph>`) + RTF('m_rtfBBB', `<Paragraph>${KEY}</Paragraph>`));
  assert.deepEqual(guidanceOf(model(only)), { texts: [], images: 0, placeholder: true });
  const mixed = CONFIG(RTF('m_rtfAAA', `<Paragraph>${KEY}</Paragraph>`) + RTF('m_rtfBBB', '<Paragraph>Real</Paragraph>'));
  assert.deepEqual(guidanceOf(model(mixed)), { texts: [['Real']], images: 0, placeholder: false });
  assert.deepEqual(guidanceOf(model(CONFIG(''))), { texts: [], images: 0, placeholder: false });
});

test('guidanceOf: a LineBreak inside a paragraph is a newline', () => {
  const xml = CONFIG(RTF('m_rtfAAA', '<Paragraph><Run>One</Run><LineBreak /><Run>Two</Run></Paragraph>'));
  assert.deepEqual(guidanceOf(model(xml))?.texts, [['One\nTwo']]);
});

test('guidanceOf: tag-like text in a Run stays literal', () => {
  const xml = CONFIG(RTF('m_rtfAAA', `<Paragraph><Run>${esc('<b>bold</b> tail')}</Run></Paragraph><Paragraph>${esc('<i>only</i>')}</Paragraph>`));
  assert.deepEqual(guidanceOf(model(esc(xml)))?.texts, [['<b>bold</b> tail', '<i>only</i>']]);
});

test('guidanceOf: paragraphs inside a List are found', () => {
  const xml = CONFIG(RTF('m_rtfAAA', '<List><ListItem><Paragraph>One</Paragraph></ListItem><ListItem><Paragraph>Two</Paragraph></ListItem></List>'));
  assert.deepEqual(guidanceOf(model(xml))?.texts, [['One', 'Two']]);
});

test('guidanceOf: a block mixing the stock key with real text keeps both', () => {
  const xml = CONFIG(RTF('m_rtfAAA', `<Paragraph>${KEY}</Paragraph><Paragraph>Real</Paragraph>`));
  assert.deepEqual(guidanceOf(model(xml)), { texts: [[KEY, 'Real']], images: 0, placeholder: false });
});

test('guidanceOf: XML escaped deeper than the limit is not found', () => {
  const wrap = (/** @type {number} */ n) => (n === 0 ? CONFIG('') : `<L>${esc(wrap(n - 1))}</L>`);
  assert.notEqual(guidanceOf(wrap(8)), null);
  assert.equal(guidanceOf(wrap(9)), null);
});

test('guidanceOf: counts non-empty images without reading them', () => {
  const xml = CONFIG(IMG('m_cfgimg_01', 'iVBORw0KGgo=') + IMG('m_cfgimg_02', '') + IMG('m_cfgimg_03', 'AAAA') + RTF('m_rtfAAA', '<Paragraph>x</Paragraph>'));
  assert.deepEqual(guidanceOf(model(xml)), { texts: [['x']], images: 2, placeholder: false });
});

test('guidanceOf: null without a GuidanceCombiConfig, on bad XML and on non-XML', () => {
  assert.equal(guidanceOf(model('<Other/>')), null);
  assert.equal(guidanceOf(''), null);
  assert.equal(guidanceOf('not xml'), null);
  assert.equal(guidanceOf('<GuidanceCombiConfig><m_rtfAAA>'), null);
  assert.equal(guidanceOf(/** @type {any} */ (undefined)), null);
});

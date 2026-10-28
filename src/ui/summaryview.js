// @ts-check
/**
 * The Summary tab's content (src/ui/protocolpanel.js): one block of display groups per
 * sub-protocol (core/summarygroups.js), the upgrade notes, and the add-in's type and guidance
 * (core/guidance.js). A read that failed shows why in its block. Document text goes in as text.
 */
import { h } from './dom.js';
import { visibleControls, visibleText } from '../core/visible.js';
import { protocolGroups } from '../core/summarygroups.js';
import { guidanceOf } from '../core/guidance.js';

/** @typedef {import('../core/preview.js').PreviewResult} PreviewResult */
/** @typedef {import('../core/addin.js').AddInText} AddInText */
/** @typedef {import('../core/summarygroups.js').SummaryGroup} SummaryGroup */

/** @param {string} title */
const blockTitle = (title) => h('h3', { class: 'pp-sum-title' }, title);

/** @param {string} what @param {string} error */
const failed = (what, error) => h('div', { class: 'pp-error' }, `${what} could not be read: ${visibleControls(error)}`);

/**
 * Groups as label/value lists; the hover gives the key and the value as stored.
 * @param {SummaryGroup[]} groups
 */
const groupLists = (groups) => groups.map((g) => h('section', null,
  h('h4', { class: 'facts-title' }, g.title),
  h('dl', { class: 'facts' }, g.items.flatMap((it) => {
    const title = `${visibleControls(it.key)} = ${visibleControls(it.raw)}`;
    return [h('dt', { title }, visibleControls(it.label)), h('dd', { title }, visibleControls(it.text))];
  }))));

/** @param {PreviewResult} p @returns {HTMLElement[]} */
function protocolBlocks(p) {
  if (!p.ok) return [h('section', null, blockTitle('Protocol'), failed('Protocol summary', p.error))];
  const blocks = protocolGroups(p);
  /** @type {HTMLElement[]} */
  const out = blocks.map((b) => h('section', null, b.title === null ? null : blockTitle(b.title), groupLists(b.groups)));
  if (blocks.length === 0 && p.upgrade === null) {
    out.push(h('section', null, blockTitle('Protocol'), h('div', { class: 'empty' }, 'The protocol has no preview')));
  }
  if (p.upgrade !== null) {
    out.push(h('section', null, blockTitle('Upgrade notes'), h('div', { class: 'pp-sum-notes' }, visibleText(p.upgrade))));
  }
  return out;
}

/** @param {AddInText} a */
function addInBlock(a) {
  if (!a.ok) return h('section', null, blockTitle('Add-in'), failed('Add-in', a.error));
  const g = a.data === null ? null : guidanceOf(a.data);
  /** @type {HTMLElement[]} */
  const body = [];
  if (g) {
    for (const paragraphs of g.texts) {
      body.push(h('div', { class: 'pp-sum-guidance' }, paragraphs.map((t) => h('p', null, visibleText(t)))));
    }
    if (g.images > 0) body.push(h('div', { class: 'pp-sum-note' }, `${g.images} image${g.images === 1 ? '' : 's'}`));
    if (g.placeholder) body.push(h('div', { class: 'pp-sum-note' }, 'Stock placeholder guidance'));
  }
  if (body.length === 0) body.push(h('div', { class: 'pp-sum-note' }, 'No guidance'));
  return h('section', null, blockTitle('Add-in'), h('div', { class: 'pp-addin-head' }, a.name === null
    ? h('span', { class: 'pp-sum-note' }, 'No type named')
    : h('span', { class: 'pp-addin-type' }, visibleControls(a.name))), body);
}

/**
 * The Summary of a step: its protocol's blocks, then its add-in's; null for what it does not have.
 * @param {PreviewResult | null} protocol
 * @param {AddInText | null} addIn
 * @returns {HTMLElement}
 */
export function summaryView(protocol, addIn) {
  return h('div', { class: 'pp-sum' }, protocol === null ? null : protocolBlocks(protocol), addIn === null ? null : addInBlock(addIn));
}

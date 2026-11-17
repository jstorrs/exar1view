// @ts-check
/**
 * The Summary tab's content (src/ui/protocolpanel.js): one block of display groups per
 * sub-protocol (core/summarygroups.js), the upgrade notes, and the add-in's type and guidance
 * (core/guidance.js), then, when diffusion is on, the Diffusion section: its settings, and for a free
 * set the vector set as a .dvs download and a list of the vectors. A read that failed shows why in its
 * block. Document text goes in as text.
 */
import { h, downloadText } from './dom.js';
import { visibleControls, visibleText } from '../core/visible.js';
import { protocolGroups } from '../core/summarygroups.js';
import { guidanceOf } from '../core/guidance.js';
import { diffusionSummary } from '../core/diffusionsummary.js';
import { dvsText, dvsFileName } from '../core/dvs.js';
import { fixed } from '../core/numfmt.js';

/** @typedef {import('../core/preview.js').PreviewResult} PreviewResult */
/** @typedef {import('../core/addin.js').AddInText} AddInText */
/** @typedef {import('../core/summarygroups.js').SummaryGroup} SummaryGroup */
/** @typedef {import('../core/diffusion.js').Diffusion} Diffusion */

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
 * The Diffusion section: its rows, then for a free set the download of the set as a .dvs file (marked
 * unavailable, with the reason beside it, when the set cannot be written faithfully) and the vectors,
 * listed when first opened; null when off. `stepLabel` is read at click time and only names the file
 * when the set has no source file name; it is not written into it.
 * @param {Diffusion} d
 * @param {() => string} stepLabel
 * @param {string} idPrefix makes the reason's id unique
 */
function diffusionBlock(d, stepLabel, idPrefix) {
  const rows = diffusionSummary(d);
  if (rows === null) return null;
  /** @type {(HTMLElement | null)[]} */
  const extra = [];
  if (d.kind === 'builtin') extra.push(h('div', { class: 'pp-sum-note' }, 'Built into the sequence; no vector set is stored.'));
  if (d.kind === 'free') {
    const { set } = d;
    const dvs = dvsText(set);
    const whyId = `${idPrefix}-dvs-why`;
    if (set.origin.builtIn) {
      extra.push(h('div', { class: 'pp-sum-note' }, 'The scanner substituted its built-in set for the selected file.'));
    }
    extra.push(h('div', { class: 'pp-dvs' },
      h('button', {
        type: 'button', class: 'btn', 'aria-disabled': String(!dvs.ok), 'aria-describedby': dvs.ok ? undefined : whyId,
        onClick: () => { if (dvs.ok) downloadText(dvsFileName(set, stepLabel()), dvs.text, 'text/plain'); },
      }, 'Download .dvs'),
      dvs.ok ? null : h('span', { id: whyId, class: 'pp-error pp-dvs-why' }, `Cannot be written as a .dvs file: ${dvs.why}`)));
    const n = set.vectors.length;
    const details = h('details', { class: 'pp-vectors' }, h('summary', null, `Show ${n} vector${n === 1 ? '' : 's'}`));
    let filled = false;
    details.addEventListener('toggle', () => {
      if (filled || !(/** @type {HTMLDetailsElement} */ (details)).open) return;
      filled = true;
      details.append(h('pre', { class: 'pp-pre mono' },
        set.vectors.map((v, i) => `${i}: ${v.map((c) => fixed(c, set.decimals)).join(', ')}`).join('\n')));
    });
    extra.push(details);
  }
  return h('section', null, h('h4', { class: 'facts-title' }, 'Diffusion'),
    h('dl', { class: 'facts' }, rows.flatMap((r) => [h('dt', null, r.label), h('dd', null, visibleControls(r.text))])),
    extra);
}

/**
 * The Summary of a step: its protocol's blocks, then its add-in's, then its diffusion settings;
 * null for what it does not have.
 * @param {PreviewResult | null} protocol
 * @param {AddInText | null} addIn
 * @param {Diffusion | null} diffusion the main block's, null without one
 * @param {() => string} stepLabel the label of the step shown, read when the file is named
 * @param {string} idPrefix
 * @returns {HTMLElement}
 */
export function summaryView(protocol, addIn, diffusion, stepLabel, idPrefix) {
  return h('div', { class: 'pp-sum' }, protocol === null ? null : protocolBlocks(protocol), addIn === null ? null : addInBlock(addIn),
    diffusion === null ? null : diffusionBlock(diffusion, stepLabel, idPrefix));
}

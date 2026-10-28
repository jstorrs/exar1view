// @ts-check
/**
 * The Cards tab's content (src/ui/protocolpanel.js): the protocol laid out as the scanner's
 * protocol print, rebuilt from the exar1 by core/cards.js with the shipped catalog: the header
 * line, then each scanner tab as a heading over its cards' label/value lines, then what could not
 * be reproduced. A value the catalog has no entry for is shown as stored and flagged. A read that
 * failed shows why. Document text goes in as text.
 */
import { h } from './dom.js';
import { visibleControls } from '../core/visible.js';
import { buildCards } from '../core/cards.js';
import { cardSources } from '../core/cardsource.js';
import { CATALOG } from '../core/catalog.js';

/** @typedef {import('../core/cards.js').Cards} Cards */
/** @typedef {import('../core/cardformulas.js').CardHeader} CardHeader */
/** @typedef {import('../core/preview.js').PreviewResult} PreviewResult */
/** @typedef {import('../platform/source.js').ProtocolText} ProtocolText */

/** @param {string} what @param {string} error */
const failed = (what, error) => h('div', { class: 'pp-error' }, `${what} could not be read: ${visibleControls(error)}`);

/**
 * The header line's fields that are set, in the print's order.
 * @param {CardHeader} hd
 * @returns {[string | null, string][]} label (null: none) and value
 */
function headerFields(hd) {
  /** @type {[string | null, string | null][]} */
  const fields = [
    ['TA', hd.ta], ['PM', hd.pm],
    ['Voxel size', hd.voxel === null ? null : `${hd.voxel} mm`], ['VoI', hd.voi === null ? null : `${hd.voi} mm`],
    ['PAT', hd.pat], ['Rel. SNR', hd.snr], [null, hd.sequence || null], ['Substep', hd.substep],
  ];
  return /** @type {[string | null, string][]} */ (fields.filter(([, v]) => v !== null));
}

/** @param {CardHeader} hd */
const headerLine = (hd) => h('div', { class: 'pp-cards-head' }, headerFields(hd).map(([label, value]) => h('span', null,
  label === null ? null : h('span', { class: 'pp-cards-key' }, `${label}: `), visibleControls(value))));

/** The card's name under its tab's heading: "Contrast - Common" → "Common"; null when it is the tab. @param {string} tab @param {string} name */
const cardTitle = (tab, name) => (name.startsWith(`${tab} - `) ? name.slice(tab.length + 3) : name === tab ? null : name);

/** @param {Cards} cards @returns {HTMLElement[]} */
function notes(cards) {
  const n = cards.omitted;
  return [
    ...(n > 0 ? [`${n} printed line${n === 1 ? '' : 's'} can't be reproduced from the exar1`] : []),
    ...(cards.approximate ? ['Card set approximated: this sequence was not in the prints the catalog was built from'] : []),
  ].map((t) => h('div', { class: 'pp-sum-note' }, t));
}

/**
 * The cards of a protocol from its text and its Preview summary.
 * @param {ProtocolText} text
 * @param {PreviewResult} summary
 * @returns {HTMLElement}
 */
export function cardsView(text, summary) {
  if (!text.ok) return h('div', { class: 'pp-sum' }, failed('Protocol', text.error));
  if (!summary.ok) return h('div', { class: 'pp-sum' }, failed('Protocol summary', summary.error));
  const cards = buildCards(CATALOG, cardSources(text.text, summary));
  const footer = notes(cards);
  // A card with no line shows nothing but its name: left out, as is a tab left empty.
  const tabs = cards.tabs.map((t) => ({ ...t, cards: t.cards.filter((c) => c.lines.length > 0) })).filter((t) => t.cards.length > 0);
  return h('div', { class: 'pp-sum' },
    headerLine(cards.header),
    tabs.length === 0 ? h('div', { class: 'empty' }, 'No card of the catalog applies to this protocol') : null,
    h('div', { class: 'pp-cards' }, tabs.map((t) => h('section', null, h('h3', { class: 'pp-sum-title' }, visibleControls(t.tab)),
      t.cards.map((c) => {
        const title = cardTitle(t.tab, c.name);
        return h('section', null,
          title === null ? null : h('h4', { class: 'facts-title' }, visibleControls(title)),
          h('dl', { class: 'facts' }, c.lines.flatMap((l) => [
            h('dt', { class: 'pp-card-label' }, visibleControls(l.label)),
            l.status === 'raw'
              ? h('dd', { class: 'pp-card-raw', title: 'value not in the catalog; shown as stored' }, visibleControls(l.text))
              : h('dd', null, visibleControls(l.text)),
          ])));
      })))),
    footer.length === 0 ? null : h('div', { class: 'pp-cards-foot' }, footer));
}

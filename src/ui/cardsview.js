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
import { headerFields } from '../core/cardformulas.js';
import { cardSources } from '../core/cardsource.js';
import { CATALOG } from '../core/catalog.js';

/** @typedef {import('../core/cards.js').Cards} Cards */
/** @typedef {import('../core/cardformulas.js').CardHeader} CardHeader */
/** @typedef {import('../core/preview.js').PreviewResult} PreviewResult */
/** @typedef {import('../platform/source.js').ProtocolText} ProtocolText */

/** @param {CardHeader} hd */
const headerLine = (hd) => h('div', { class: 'pp-cards-head' }, headerFields(hd).map(([label, value]) => h('span', null,
  label === null ? null : h('span', { class: 'pp-cards-key' }, `${label}: `), visibleControls(value))));

/** The title of a value shown as stored. */
export const RAW_TITLE = 'value not in the catalog; shown as stored';

/** The card's name under its tab's heading: "Contrast - Common" → "Common"; null when it is the tab. @param {string} tab @param {string} name */
export const cardTitle = (tab, name) => (name.startsWith(`${tab} - `) ? name.slice(tab.length + 3) : name === tab ? null : name);

/** What the cards leave out or only approximate. @param {Cards} cards @returns {string[]} */
export function cardNotes(cards) {
  const n = cards.omitted;
  return [
    ...(n > 0 ? [`${n} printed line${n === 1 ? '' : 's'} can't be reproduced from the exar1`] : []),
    ...(cards.approximate ? ['Card set approximated: this sequence was not in the prints the catalog was built from'] : []),
  ];
}

/**
 * The cards of a protocol from its text and its Preview summary, or why one could not be read
 * (the error is raw: pass it through visibleControls to show it).
 * @param {ProtocolText} text
 * @param {PreviewResult} summary
 * @returns {{ ok: true, cards: Cards } | { ok: false, error: string }}
 */
export function cardsOf(text, summary) {
  if (!text.ok) return { ok: false, error: `Protocol could not be read: ${text.error}` };
  if (!summary.ok) return { ok: false, error: `Protocol summary could not be read: ${summary.error}` };
  return { ok: true, cards: buildCards(CATALOG, cardSources(text.text, summary)) };
}

/**
 * The cards of a protocol from its text and its Preview summary.
 * @param {ProtocolText} text
 * @param {PreviewResult} summary
 * @returns {HTMLElement}
 */
export function cardsView(text, summary) {
  const read = cardsOf(text, summary);
  if (!read.ok) return h('div', { class: 'pp-sum' }, h('div', { class: 'pp-error' }, visibleControls(read.error)));
  const { cards } = read;
  const footer = cardNotes(cards).map((t) => h('div', { class: 'pp-sum-note' }, t));
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
              ? h('dd', { class: 'pp-card-raw', title: RAW_TITLE }, visibleControls(l.text))
              : h('dd', null, visibleControls(l.text)),
          ])));
      })))),
    footer.length === 0 ? null : h('div', { class: 'pp-cards-foot' }, footer));
}

// @ts-check
/**
 * The focused step's protocol beside the program view (one-pane view on a wide window only): a
 * title, the protocol's warnings, a filter on the parameter name and each ASCCONV block (main
 * protocol, then sub-protocols) as `key = value` lines in text order, values raw as stored. A DOM
 * shell over core/paramlist.js and FileSource.protocol, reached through `load`.
 *
 * The title follows the step at once; the read waits until the focus has rested for READ_DELAY,
 * so moving through the list reads only where it stops. Hidden, the panel reads nothing and a
 * read under way is dropped, as is a late read for a step no longer shown. A protocol's lines are
 * built once when it arrives; the filter (whose text stays when the step changes) only picks
 * which of them are shown.
 */
import { h } from './dom.js';
import { visibleControls } from '../core/visible.js';
import { measurementDetail } from '../core/model.js';
import { keyIndex, paramSections, blockTitle } from '../core/paramlist.js';

/** @typedef {import('../core/model.js').Step} Step */
/** @typedef {import('../platform/source.js').Protocol} Protocol */
/** @typedef {import('../core/paramlist.js').KeyIndex} KeyIndex */

/**
 * @typedef {object} ProtocolPanel
 * @property {HTMLElement} el
 * @property {(target: {fileId: string, step: Step} | null) => void} show the step whose protocol
 *   to show (the step list's focus), or none
 * @property {(on: boolean) => void} setShown whether the panel is on screen; hidden, it reads nothing
 * @property {(named: (what: string) => string) => void} setNames name the panel's regions (see pane.js named)
 */

/**
 * What the lines show: the protocol of `key` (its file id and blob; '' for none) being read, or
 * read, with its lines built (`lines[block][i]` is the i-th key of that block).
 * @typedef {{ key: string, state: 'reading' }
 *   | { key: string, state: 'error', error: string }
 *   | { key: string, state: 'read', index: KeyIndex, headings: HTMLElement[], lines: HTMLElement[][] }} Shown
 */

/** How long the focus must rest on a step before its protocol is read (ms). */
const READ_DELAY = 80;

/**
 * @param {{ load: (fileId: string, blob: string) => Promise<Protocol> }} deps `load` never rejects
 * @returns {ProtocolPanel}
 */
export function createProtocolPanel({ load }) {
  /** @type {{fileId: string, step: Step} | null} */
  let target = null;
  let shown = false;
  /** @type {Shown} */
  let current = { key: '', state: 'reading' };
  /** Bumped per read and when hidden, so a waiting or late read of an earlier step is dropped. */
  let generation = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  const titleEl = h('h2', { class: 'pp-title' }, 'Protocol');
  const warnSummary = h('summary');
  const warnList = h('ul');
  const warnEl = h('details', { class: 'pp-warn', hidden: true }, warnSummary, warnList);
  const filter = /** @type {HTMLInputElement} */ (h('input', {
    type: 'search', class: 'search pp-filter', placeholder: 'Filter parameters', autocomplete: 'off',
    spellcheck: false, 'aria-label': 'Filter protocol parameters by name', onInput: () => renderLines(),
    onKeydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape' && filter.value !== '') {
        e.preventDefault();
        e.stopPropagation();
        filter.value = '';
        renderLines();
      }
    },
  }));
  const linesEl = h('div', { class: 'pp-lines', tabindex: 0, role: 'region' });
  const el = h('section', { class: 'protocol-panel', role: 'region', hidden: true },
    titleEl, warnEl, filter, linesEl);

  /** Stop a waiting or running read. */
  function drop() {
    generation++;
    clearTimeout(timer);
  }

  /** Bring the panel up to date with `target`, reading its protocol if it is shown and not read yet. */
  function update() {
    titleEl.textContent = target ? `Protocol: ${visibleControls(target.step.label)}` : 'Protocol';
    const blob = target ? measurementDetail(target.step)?.protocolBlob ?? null : null;
    if (target === null || blob === null) {
      drop();
      current = { key: '', state: 'reading' };
      setWarnings([]);
      message(target ? 'No protocol' : 'Select a step to see its protocol');
      return;
    }
    const key = JSON.stringify([target.fileId, blob]);
    if (!shown || key === current.key) return;
    drop();
    const gen = generation;
    const fileId = target.fileId;
    current = { key, state: 'reading' };
    setWarnings([]);
    linesEl.scrollTop = 0;
    renderLines();
    timer = setTimeout(() => {
      if (gen !== generation) return;
      void load(fileId, blob).then((protocol) => {
        if (gen !== generation) return;
        current = protocol.ok ? built(key, protocol) : { key, state: 'error', error: protocol.error };
        setWarnings(protocol.ok ? protocol.warnings : []);
        renderLines();
      });
    }, READ_DELAY);
  }

  /**
   * The protocol's headings and lines, built once.
   * @param {string} key @param {Extract<Protocol, { ok: true }>} p
   * @returns {Shown}
   */
  function built(key, p) {
    return {
      key, state: 'read', index: keyIndex(p.blocks),
      headings: p.blocks.map((_, i) => h('h3', { class: 'facts-title' }, blockTitle(i))),
      lines: p.blocks.map((block) => [...block].map(([k, v]) => h('div', { class: 'pp-line' },
        h('span', { class: 'pp-key' }, visibleControls(k)), h('span', { class: 'pp-eq' }, ' = '), visibleControls(v)))),
    };
  }

  /** @param {string} text */
  function message(text) {
    linesEl.replaceChildren(h('div', { class: 'empty' }, text));
  }

  /** @param {readonly string[]} warnings */
  function setWarnings(warnings) {
    warnEl.hidden = warnings.length === 0;
    warnSummary.textContent = `⚠ ${warnings.length} protocol warning${warnings.length === 1 ? '' : 's'}`;
    warnList.replaceChildren(...warnings.map((w) => h('li', null, visibleControls(w))));
  }

  function renderLines() {
    if (current.key === '') return;
    if (current.state === 'reading') {
      message('Reading…');
      return;
    }
    if (current.state === 'error') {
      linesEl.replaceChildren(h('div', { class: 'pp-error' }, `Protocol could not be read: ${visibleControls(current.error)}`));
      return;
    }
    const { headings, lines } = current;
    const { sections, empty } = paramSections(current.index, filter.value);
    if (empty !== null) {
      message(empty);
      return;
    }
    linesEl.replaceChildren(...sections.map((s) => h('section', null, headings[s.block],
      h('div', { class: 'pp-block mono' }, s.lines.map((i) => lines[s.block][i])))));
  }

  update();
  return {
    el,
    show: (next) => {
      target = next;
      update();
    },
    setShown: (on) => {
      if (on === shown) return;
      shown = on;
      el.hidden = !on;
      if (!on) {
        drop();
        // A read that was dropped starts again when the panel is shown.
        if (current.state === 'reading') current = { key: '', state: 'reading' };
      }
      update();
    },
    setNames: (named) => {
      el.setAttribute('aria-label', named('Protocol'));
      linesEl.setAttribute('aria-label', named('Protocol parameters'));
    },
  };
}

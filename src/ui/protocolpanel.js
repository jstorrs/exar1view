// @ts-check
/**
 * The focused step's protocol and add-in beside the program view (one-pane view on a wide window
 * only): a title, then tabs. **Summary** (src/ui/summaryview.js) has the protocol's Preview values
 * in display groups per sub-protocol, its upgrade notes, and the add-in's type and guidance;
 * **XProtocol** is the protocol text without its ASCCONV blocks;
 * **ASCCONV** has the protocol's warnings, a filter on the parameter name and each ASCCONV block
 * (main protocol, then sub-protocols) as `key = value` lines in text order, values raw as stored;
 * **Add-in** is the add-in's type and its Data laid out as indented XML (core/xmltext.js). A step
 * has Summary when it has either, XProtocol and ASCCONV when it has a protocol and Add-in when it
 * has an add-in. Summary is shown first; the chosen tab is kept as the focus moves, and a step
 * without it shows its first. A DOM shell over
 * core/paramlist.js, core/ascconv.js withoutAscconv and core/xmltext.js, reading through `deps`.
 *
 * The title follows the step at once; the shown tab is read when the focus has rested for
 * READ_DELAY, so moving through the list reads only where it stops, and each tab is read once per
 * step however often it is shown. Hidden, the panel reads nothing and a read under way is dropped,
 * as is a late read for a step no longer shown. A protocol's lines are built once when it arrives;
 * the filter (whose text stays when the step changes) only picks which of them are shown.
 */
import { h } from './dom.js';
import { visibleControls, visibleText } from '../core/visible.js';
import { stepViews, shownView } from '../core/stepinfo.js';
import { withoutAscconv } from '../core/ascconv.js';
import { formatXml } from '../core/xmltext.js';
import { keyIndex, paramSections, blockTitle } from '../core/paramlist.js';
import { summaryView } from './summaryview.js';

/** @typedef {import('../core/model.js').Step} Step */
/** @typedef {import('../platform/source.js').Protocol} Protocol */
/** @typedef {import('../platform/source.js').ProtocolText} ProtocolText */
/** @typedef {import('../platform/source.js').AddInText} AddInText */
/** @typedef {import('../platform/source.js').ProtocolSummary} ProtocolSummary */
/** @typedef {import('../core/paramlist.js').KeyIndex} KeyIndex */
/** @typedef {import('../core/stepinfo.js').StepViewSource} StepViewSource */

/**
 * @typedef {object} ProtocolPanel
 * @property {HTMLElement} el
 * @property {(target: {fileId: string, step: Step} | null) => void} show the step whose protocol
 *   to show (the step list's focus), or none
 * @property {(on: boolean) => void} setShown whether the panel is on screen; hidden, it reads nothing
 * @property {(named: (what: string) => string) => void} setNames name the panel's regions (see pane.js named)
 */

/**
 * The panel's sources, by file id and Content hash; none rejects.
 * @typedef {object} ProtocolPanelDeps
 * @property {(fileId: string, blob: string) => Promise<Protocol>} load a parsed protocol
 * @property {(fileId: string, blob: string) => Promise<ProtocolText>} loadText a protocol's text
 * @property {(fileId: string, blob: string) => Promise<ProtocolSummary>} loadSummary a protocol's Preview summary
 * @property {(fileId: string, blob: string) => Promise<AddInText>} loadAddIn an add-in with its Data
 */

/** @typedef {import('../core/stepinfo.js').StepView} Tab */

/**
 * What a tab shows: the documents of `key` (its file id and blobs; '' for none) being read, or read,
 * with what was built from it.
 * @template T
 * @typedef {{ key: string, state: 'reading' }
 *   | { key: string, state: 'error', error: string }
 *   | { key: string, state: 'read', value: T }} Shown
 */

/**
 * A protocol's warnings and ASCCONV lines, built (`lines[block][i]` is the i-th key of that block).
 * @typedef {{ warnings: string[], index: KeyIndex, headings: HTMLElement[], lines: HTMLElement[][] }} Lines
 */

/**
 * An add-in's type, its Name as stored and its Data laid out (null: none, or only whitespace), all made visible.
 * @typedef {{ type: string, raw: string | null, data: string | null }} AddInView
 */

/** Multi-line document text to show: CRLF as LF, other controls made visible. @param {string} text */
const shownText = (text) => visibleText(text.replace(/\r\n/g, '\n'));

/**
 * What the Add-in tab shows of an add-in.
 * @param {Extract<AddInText, { ok: true }>} a
 * @returns {AddInView}
 */
const addInView = (a) => ({
  type: a.name === null ? 'Add-in' : visibleControls(a.name),
  raw: a.raw === null ? null : visibleControls(a.raw),
  data: a.data === null || a.data.trim() === '' ? null : shownText(formatXml(a.data)),
});

/** @type {readonly Tab[]} */
const TABS = ['summary', 'xprotocol', 'ascconv', 'addin'];
/** @type {Record<Tab, string>} */
const TAB_NAMES = { summary: 'Summary', xprotocol: 'XProtocol', ascconv: 'ASCCONV', addin: 'Add-in' };

/** How long the focus must rest on a step before its protocol is read (ms). */
const READ_DELAY = 80;

let panelCounter = 0;

/**
 * @param {ProtocolPanelDeps} deps
 * @returns {ProtocolPanel}
 */
export function createProtocolPanel({ load, loadText, loadSummary, loadAddIn }) {
  const id = `pp${++panelCounter}`;
  /** @type {{fileId: string, step: Step} | null} */
  let target = null;
  let shown = false;
  /** The tab the user chose, shown whenever the step has it. @type {Tab} */
  let chosen = 'summary';
  /** The focused step's tabs, and the one shown. @type {Tab[]} */
  let tabs = [];
  /** @type {Tab} */
  let selected = 'summary';
  /** The Summary, built. @type {Shown<HTMLElement>} */
  let summary = { key: '', state: 'reading' };
  /** @type {Shown<string>} */
  let xprotocol = { key: '', state: 'reading' };
  /** @type {Shown<Lines>} */
  let ascconv = { key: '', state: 'reading' };
  /** @type {Shown<AddInView>} */
  let addIn = { key: '', state: 'reading' };
  /** Bumped per read and when hidden, so a waiting or late read of an earlier step is dropped. */
  let generation = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  const titleEl = h('h2', { class: 'pp-title' }, 'Protocol');
  /** @type {Record<Tab, HTMLElement>} */
  const tabEls = /** @type {any} */ (Object.fromEntries(TABS.map((t) => [t, h('button', {
    type: 'button', class: 'pp-tab', role: 'tab', id: `${id}-tab-${t}`, 'aria-controls': `${id}-panel-${t}`,
    'aria-selected': false, tabindex: -1, hidden: true, onClick: () => choose(t),
  }, TAB_NAMES[t])])));
  const tabList = h('div', { class: 'pp-tabs', role: 'tablist', hidden: true, onKeydown: onTabKey }, TABS.map((t) => tabEls[t]));
  const emptyEl = h('div', { class: 'empty pp-empty' });

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
  const summaryEl = h('div', { class: 'pp-text', tabindex: 0, role: 'region' });
  const xprotocolEl = h('div', { class: 'pp-text', tabindex: 0, role: 'region' });
  const addInEl = h('div', { class: 'pp-text', tabindex: 0, role: 'region' });
  /** @param {Tab} t @param {...HTMLElement} children */
  const tabPanel = (t, ...children) => h('div', {
    class: 'pp-panel', role: 'tabpanel', id: `${id}-panel-${t}`, 'aria-labelledby': `${id}-tab-${t}`, hidden: true,
  }, ...children);
  /** @type {Record<Tab, HTMLElement>} */
  const panels = {
    summary: tabPanel('summary', summaryEl),
    xprotocol: tabPanel('xprotocol', xprotocolEl),
    ascconv: tabPanel('ascconv', warnEl, filter, linesEl),
    addin: tabPanel('addin', addInEl),
  };
  const el = h('section', { class: 'protocol-panel', role: 'region', hidden: true },
    titleEl, tabList, emptyEl, TABS.map((t) => panels[t]));

  /** Stop a waiting or running read; what it was reading is read again when next shown. */
  function drop() {
    generation++;
    clearTimeout(timer);
    if (summary.state === 'reading') summary = { key: '', state: 'reading' };
    if (xprotocol.state === 'reading') xprotocol = { key: '', state: 'reading' };
    if (ascconv.state === 'reading') ascconv = { key: '', state: 'reading' };
    if (addIn.state === 'reading') addIn = { key: '', state: 'reading' };
  }

  /** @param {Tab} t */
  function choose(t) {
    chosen = t;
    update();
  }

  /** Left and Right (wrapping), Home and End move between the step's tabs. @param {KeyboardEvent} e */
  function onTabKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const i = tabs.indexOf(selected);
    const n = tabs.length;
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined || n === 0) return;
    e.preventDefault();
    choose(tabs[to]);
    tabEls[tabs[to]].focus();
  }

  /** Bring the panel up to date with `target`, reading the shown tab if it is shown and not read yet. */
  function update() {
    titleEl.textContent = target ? `Step: ${visibleControls(target.step.label)}` : 'Protocol';
    const views = target ? stepViews(target.step) : [];
    tabs = views.map((v) => v.view);
    const show = shownView(tabs, chosen);
    selected = show ?? chosen;
    tabList.hidden = tabs.length === 0;
    emptyEl.hidden = tabs.length > 0;
    for (const t of TABS) {
      tabEls[t].hidden = !tabs.includes(t);
      tabEls[t].setAttribute('aria-selected', String(t === selected));
      tabEls[t].tabIndex = t === selected ? 0 : -1;
      panels[t].hidden = !(tabs.includes(t) && t === selected);
    }
    const view = views.find((v) => v.view === show) ?? null;
    if (target === null || view === null) {
      drop();
      summary = xprotocol = ascconv = addIn = { key: '', state: 'reading' };
      emptyEl.textContent = target ? 'No protocol or add-in' : 'Select a step to see its protocol';
      return;
    }
    const key = JSON.stringify(view.view === 'summary' ? [target.fileId, view.protocol, view.addIn] : [target.fileId, view.blob]);
    const tab = view.view;
    if (!shown || key === { summary, xprotocol, ascconv, addin: addIn }[tab].key) return;
    drop();
    const gen = generation;
    const fileId = target.fileId;
    /** @type {{ key: string, state: 'reading' }} */
    const reading = { key, state: 'reading' };
    if (tab === 'summary') summary = reading;
    else if (tab === 'xprotocol') xprotocol = reading;
    else if (tab === 'ascconv') ascconv = reading;
    else addIn = reading;
    render(tab);
    timer = setTimeout(() => {
      if (gen === generation) void read(view, fileId, key, () => gen === generation);
    }, READ_DELAY);
  }

  /**
   * Read `view`'s documents, build what it shows and show it, unless `current()` says the read was dropped.
   * @param {StepViewSource} view @param {string} fileId @param {string} key @param {() => boolean} current
   */
  async function read(view, fileId, key, current) {
    if (view.view === 'summary') {
      const [p, a] = await Promise.all([
        view.protocol === null ? null : loadSummary(fileId, view.protocol),
        view.addIn === null ? null : loadAddIn(fileId, view.addIn),
      ]);
      if (!current()) return;
      summary = { key, state: 'read', value: summaryView(p, a) };
    } else if (view.view === 'ascconv') {
      const p = await load(fileId, view.blob);
      if (!current()) return;
      ascconv = p.ok ? { key, state: 'read', value: built(p) } : { key, state: 'error', error: p.error };
    } else if (view.view === 'xprotocol') {
      const t = await loadText(fileId, view.blob);
      if (!current()) return;
      xprotocol = t.ok ? { key, state: 'read', value: shownText(withoutAscconv(t.text)) } : { key, state: 'error', error: t.error };
    } else {
      const a = await loadAddIn(fileId, view.blob);
      if (!current()) return;
      addIn = a.ok ? { key, state: 'read', value: addInView(a) } : { key, state: 'error', error: a.error };
    }
    render(view.view);
  }

  /**
   * The protocol's headings and lines, built once.
   * @param {Extract<Protocol, { ok: true }>} p
   * @returns {Lines}
   */
  function built(p) {
    return {
      warnings: p.warnings,
      index: keyIndex(p.blocks),
      headings: p.blocks.map((_, i) => h('h3', { class: 'facts-title' }, blockTitle(i))),
      lines: p.blocks.map((block) => [...block].map(([k, v]) => h('div', { class: 'pp-line' },
        h('span', { class: 'pp-key' }, visibleControls(k)), h('span', { class: 'pp-eq' }, ' = '), visibleControls(v)))),
    };
  }

  /** @param {HTMLElement} into @param {string} text */
  function message(into, text) {
    into.replaceChildren(h('div', { class: 'empty' }, text));
  }

  /** @param {readonly string[]} warnings */
  function setWarnings(warnings) {
    warnEl.hidden = warnings.length === 0;
    warnSummary.textContent = `⚠ ${warnings.length} protocol warning${warnings.length === 1 ? '' : 's'}`;
    warnList.replaceChildren(...warnings.map((w) => h('li', null, visibleControls(w))));
  }

  /** Show what `tab` has, from the top when it is being read. @param {Tab} tab */
  function render(tab) {
    if (tab === 'ascconv') {
      setWarnings(ascconv.state === 'read' ? ascconv.value.warnings : []);
      if (ascconv.state === 'reading') linesEl.scrollTop = 0;
      renderLines();
      return;
    }
    if (tab === 'summary') {
      if (summary.state === 'reading') {
        summaryEl.scrollTop = 0;
        message(summaryEl, 'Reading…');
      } else if (summary.state === 'read') summaryEl.replaceChildren(summary.value);
      return;
    }
    const s = tab === 'xprotocol' ? xprotocol : addIn;
    const into = tab === 'xprotocol' ? xprotocolEl : addInEl;
    const what = tab === 'xprotocol' ? 'Protocol' : 'Add-in';
    if (s.state === 'reading') {
      into.scrollTop = 0;
      message(into, 'Reading…');
    } else if (s.state === 'error') {
      into.replaceChildren(h('div', { class: 'pp-error' }, `${what} could not be read: ${visibleControls(s.error)}`));
    } else if (typeof s.value === 'string') {
      if (s.value === '') message(into, 'No XProtocol outside the ASCCONV blocks');
      else into.replaceChildren(h('div', { class: 'pp-pre mono' }, s.value));
    } else {
      const { type, raw, data } = s.value;
      into.replaceChildren(
        h('div', { class: 'pp-addin-head' }, h('span', { class: 'pp-addin-type' }, type),
          raw !== null && raw !== type ? h('span', { class: 'pp-addin-raw' }, raw) : null),
        data === null ? h('div', { class: 'empty' }, 'The add-in has no Data') : h('div', { class: 'pp-pre mono' }, data));
    }
  }

  function renderLines() {
    if (ascconv.key === '') return;
    if (ascconv.state === 'reading') {
      message(linesEl, 'Reading…');
      return;
    }
    if (ascconv.state === 'error') {
      linesEl.replaceChildren(h('div', { class: 'pp-error' }, `Protocol could not be read: ${visibleControls(ascconv.error)}`));
      return;
    }
    const { headings, lines, index } = ascconv.value;
    const { sections, empty } = paramSections(index, filter.value);
    if (empty !== null) {
      message(linesEl, empty);
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
      // A read that was dropped starts again when the panel is shown.
      if (!on) drop();
      update();
    },
    setNames: (named) => {
      el.setAttribute('aria-label', named('Protocol'));
      tabList.setAttribute('aria-label', named('Protocol views'));
      linesEl.setAttribute('aria-label', named('Protocol parameters'));
      summaryEl.setAttribute('aria-label', named('Protocol summary'));
      xprotocolEl.setAttribute('aria-label', named('XProtocol text'));
      addInEl.setAttribute('aria-label', named('Add-in configuration'));
    },
  };
}

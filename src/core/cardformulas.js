// @ts-check
/**
 * The hand-written card formulas a catalog rule names (`{kind: "formula", name}`). Pure.
 *
 * A formula gets the protocol's sources, the group index (null outside a grouped slot) and the
 * rule's variant for the protocol's sequence (null when it has none). It returns the value text,
 * `{label, text}` for a slot whose label it computes (`@…` ids), or null when it does not apply.
 */

/** @typedef {import('./cardsource.js').CardSources} CardSources */
/** @typedef {(src: CardSources, group: number | null, variant: string | null) => string | { label: string, text: string } | null} CardFormula */

/** @type {ReadonlyMap<string, CardFormula>} */
export const FORMULAS = new Map([
  // The header line of a grouped block: "Slice group" with value "1", "2", ...
  ['group_number', (_src, group) => (group === null ? null : String(group + 1))],
]);

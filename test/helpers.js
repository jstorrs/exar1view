// Helpers shared by the tests.

/** Labels of a body, a fork as [split, [branch labels...], join]. */
export const shape = (body) => body.map((n) => (n.type === 'step'
  ? n.step.label
  : [n.split.label, n.branches.map((b) => shape(b.body)), n.join.label]));

/** @typedef {import('../src/core/model.js').Step} Step */
/** @typedef {import('../src/core/model.js').Program} Program */
/** @typedef {import('../src/core/model.js').Condition} Condition */
/** @typedef {import('../src/core/model.js').BodyNode} BodyNode */

/**
 * A step of `kind` named `name` (key s:<name>, ObjectId o:<name>); `more` overrides fields.
 * @param {Step['kind']} kind @param {string} name @param {Partial<Step>} [more] @returns {Step}
 */
export const step = (kind, name, more = {}) => /** @type {Step} */ ({
  key: `s:${name}`, ids: { element: name, instance: name, object: `o:${name}` }, label: name, comment: null,
  tags: {}, rank: null, problems: [], kind, detail: {}, ...more,
});
/** @param {Step} s @returns {BodyNode} */
export const node = (s) => ({ type: 'step', step: s });
/** @param {string} id @param {Condition['kind']} kind @param {string[]} choices @param {Partial<Condition>} [more] @returns {Condition} */
export const cond = (id, kind, choices, more = {}) => ({
  id, kind, label: id, description: null, choices: choices.map((c) => ({ objectId: c, label: c })), defaultChoice: choices[0], ...more,
});
/**
 * A fork named `name`; branch i has choice i, the first is the default.
 * @param {string} name @param {Condition} c @param {BodyNode[][]} bodies @returns {Extract<BodyNode, { type: 'fork' }>}
 */
export const fork = (name, c, bodies) => ({
  type: 'fork', split: step('Split', `${name}-split`, { detail: { conditionId: c.id } }), join: step('Join', `${name}-join`, { detail: { conditionId: c.id } }), condition: c,
  branches: bodies.map((body, i) => ({ choice: c.choices[i], isDefault: i === 0, body })),
});
/** @param {BodyNode[]} body @param {Partial<Program>} [more] @returns {Program} */
export const program = (body, more = {}) => ({
  key: 'p', ids: { element: 'p', object: 'p' }, label: 'P', comment: null, tags: {}, path: [], body,
  conditions: [], copyRefs: [], order: 'links', problems: [], ...more,
});

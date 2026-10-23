// Helpers shared by the tests.

/** Labels of a body, a fork as [split, [branch labels...], join]. */
export const shape = (body) => body.map((n) => (n.type === 'step'
  ? n.step.label
  : [n.split.label, n.branches.map((b) => shape(b.body)), n.join.label]));

// Write the synthetic exar1 fixture (test/fixture/spec.js) to a file, for trying the app by hand.
//   node scripts/make-fixture.mjs out.exar1            the default fixture
//   node scripts/make-fixture.mjs --variant out.exar1  the edited variant, to compare programs with the default
import { writeFileSync } from 'node:fs';
import { buildExar } from '../test/fixture/builder.js';
import { defaultSpec, variantSpec } from '../test/fixture/spec.js';

const args = process.argv.slice(2);
const variant = args.includes('--variant');
const out = args.find((a) => a !== '--variant');
if (!out) {
  console.error('usage: node scripts/make-fixture.mjs [--variant] <out.exar1>');
  process.exit(2);
}
writeFileSync(out, buildExar(variant ? variantSpec : defaultSpec));
console.log(`wrote ${out}`);

// Write the synthetic exar1 fixture (test/fixture/spec.js) to a file, for trying the app by hand.
//   node scripts/make-fixture.mjs out.exar1
import { writeFileSync } from 'node:fs';
import { buildExar } from '../test/fixture/builder.js';

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/make-fixture.mjs <out.exar1>');
  process.exit(2);
}
writeFileSync(out, buildExar());
console.log(`wrote ${out}`);

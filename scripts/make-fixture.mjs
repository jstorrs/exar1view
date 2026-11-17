// Write the synthetic exar1 fixture (test/fixture/spec.js) to a file, for trying the app by hand.
//   node scripts/make-fixture.mjs out.exar1            the default fixture
//   node scripts/make-fixture.mjs --variant out.exar1  the edited variant, to compare programs with the default
//   node scripts/make-fixture.mjs --diffusion out.exar1  one program of diffusion protocols (free vector sets, built-in modes)
import { writeFileSync } from 'node:fs';
import { buildExar } from '../test/fixture/builder.js';
import { defaultSpec, diffusionSpec, variantSpec } from '../test/fixture/spec.js';

const args = process.argv.slice(2);
const variant = args.includes('--variant');
const diffusion = args.includes('--diffusion');
const out = args.find((a) => !a.startsWith('--'));
if (!out || (variant && diffusion) || args.some((a) => a.startsWith('--') && a !== '--variant' && a !== '--diffusion')) {
  console.error('usage: node scripts/make-fixture.mjs [--variant | --diffusion] <out.exar1>');
  process.exit(2);
}
writeFileSync(out, buildExar(variant ? variantSpec : diffusion ? diffusionSpec : defaultSpec));
console.log(`wrote ${out}`);

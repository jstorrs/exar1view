# exarview

A browser tool for MR technologists to look inside Siemens `.exar1` files
(SQLite exports of one exam tree). Drop files onto the page, browse the tree
Region › Exam › Program laid out like Dot Cockpit, and compare the protocol
parameters of two measurement steps.

## Privacy

Files are read in this browser only. Nothing is uploaded or stored. Directory
passwords are never read.

## Running it

Static HTML and JavaScript, no build step, no dependencies.

```sh
npm run serve
```

Open <http://localhost:8000/>.

## Development

```sh
npm test            # node --test, no install needed
npm run typecheck   # strict JSDoc type check (fetches TypeScript via npx)
```

Real exports are confidential and never committed; to check them, run
`EXAR1_DIR=/path/to/exports npm test` (without it those tests are skipped).

`node scripts/make-fixture.mjs out.exar1` writes a synthetic `.exar1` (from `test/fixture/spec.js`) to try in the browser.

`src/core/` is pure logic, testable under `node --test`; `src/ui/` and
`src/main.js` hold the DOM code.

## Single-file build

```sh
npm run build
```

Writes `dist/exarview.html`: the page with the CSS, sql.js (script and WASM) and
the bundled app inlined, plus a hash-based Content-Security-Policy, so it works
when opened from `file://` on an offline PC. The build fetches esbuild with
`npx`, so it needs network; `dist/` is not committed. `scripts/check-single.mjs`
runs after the build and offline: no external `src=`/`href=`, the embedded WASM
matches `vendor/sql.js/VERSION`, one CSP whose hashes match the inline code,
and size under 3 MB. Re-run it on its own to verify a copied file:
`node scripts/check-single.mjs dist/exarview.html`. The build script is tested on Linux and macOS.

## Vendored code

`vendor/sql.js/` holds sql.js 1.14.2 (`sql-wasm.js`, `sql-wasm.wasm`, LICENSE) and
`vendor/fflate/` holds fflate 0.8.3 (`browser.js`, `browser.d.ts`, LICENSE), used
for raw-DEFLATE inflate. Each `VERSION` records the version, npm integrity string and sha256 of
both dist files; `npm test` checks the files against it. To update: in a fresh
empty directory run `npm pack sql.js@<version>`, extract it (run nothing from
it), copy `dist/sql-wasm.js`, `dist/sql-wasm.wasm` and `LICENSE` over the
vendored files, confirm `sql-wasm.js` has no `</script` or `<!--`, and update
`VERSION`.

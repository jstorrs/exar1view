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

`src/core/` is pure logic, testable under `node --test`; `src/ui/` and
`src/main.js` hold the DOM code.

## Vendored code

`vendor/sql.js/` holds sql.js 1.14.2 (`sql-wasm.js`, `sql-wasm.wasm`, LICENSE).
`vendor/sql.js/VERSION` records the version, npm integrity string and sha256 of
both dist files; `npm test` checks the files against it. To update: in a fresh
empty directory run `npm pack sql.js@<version>`, extract it (run nothing from
it), copy `dist/sql-wasm.js`, `dist/sql-wasm.wasm` and `LICENSE` over the
vendored files, confirm `sql-wasm.js` has no `</script` or `<!--`, and update
`VERSION`.

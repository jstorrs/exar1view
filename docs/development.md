# Development and build notes

[Back to the README](../README.md)

## Project checks

The project uses Node.js and npm. CI runs on Node 22. The scripts are:

```sh
npm test            # node --test
npm run typecheck   # strict JSDoc type check; npx fetches TypeScript
npm run build       # build and check the offline single-file app
npm run serve       # python3 -m http.server 8000
```

No npm package installation is needed to serve or run tests; runtime libraries
are vendored in [`vendor/`](../vendor/). Typecheck and build use `npx` and may
need network access to fetch their tools.

Real exports are confidential and must not be committed. To include them in
tests, set `EXAR1_DIR=/path/to/exports npm test`; tests that use the directory
are skipped otherwise. The synthetic browser fixture can be generated with:

```sh
node scripts/make-fixture.mjs out.exar1
```

It is built from [`test/fixture/spec.js`](../test/fixture/spec.js). Core logic
is in [`src/core/`](../src/core/) and is tested under `node --test`; DOM code is
in [`src/ui/`](../src/ui/) and [`src/main.js`](../src/main.js).

## Scanner card catalog

[`src/core/cardcatalog.json`](../src/core/cardcatalog.json) describes the
scanner cards and lines used to rebuild printed protocols: their order and how
each value follows from protocol data. Its schema is in
[`src/core/cards.js`](../src/core/cards.js). The catalog is generated, not
hand-edited, from scanner prints of `.exar1` exports. It contains scanner
vocabulary only; cards, lines, sequence names, and values seen only in prints
of customer or research sequences are excluded. The source keys for each line
(never printed values) are reviewed by hand in
[`tools/cards/rules.json`](../tools/cards/rules.json).

To regenerate, place each export beside its print (`X.exar1` and `X.xml`) in
one directory, then run:

```sh
node tools/cards/build-catalog.mjs /path/to/prints
```

The deterministic build reports per-line accuracy, dropped rules and reasons,
lines without rules, and all constants, lookup tables, condition values, and
sequence names held by the catalog. Review that report before committing.
Prints and exports are confidential site data and must not be committed; only
the catalog is committed.

## Offline single-file build

```sh
npm run build
```

This writes `dist/exar1view.html` with CSS, sql.js (JavaScript and WASM), and
the app bundled inline. It includes a hash-based Content-Security-Policy and
works from `file://` on an offline PC. The build fetches esbuild through `npx`,
so it needs network access; `dist/` is not committed.

[`scripts/check-single.mjs`](../scripts/check-single.mjs) runs after building
and can also check a copied file offline:

```sh
node scripts/check-single.mjs dist/exar1view.html
```

It checks for external `src=`/`href=`, verifies embedded WASM against
`vendor/sql.js/VERSION`, checks that the CSP hashes match inline code, and
requires the file to be under 3 MB. The build script is tested on Linux and
macOS.

Each push to `main` runs tests and the build in
`.github/workflows/pages.yml`, then publishes the single-file app at
[the hosted app](https://jstorrs.github.io/exar1view/) and its
[downloadable offline file](https://jstorrs.github.io/exar1view/exar1view.html).

## Vendored code

[`vendor/sql.js/`](../vendor/sql.js/) contains sql.js 1.14.2
(`sql-wasm.js`, `sql-wasm.wasm`, and `LICENSE`); [`vendor/fflate/`](../vendor/fflate/)
contains fflate 0.8.3 (`browser.js`, `browser.d.ts`, and `LICENSE`) for raw
DEFLATE inflation. Each `VERSION` records the version, npm integrity string,
and SHA-256 of both distribution files; `npm test` checks these files.

To update sql.js, use a fresh empty directory:

```sh
npm pack sql.js@<version>
```

Extract the package without running anything from it. Copy `dist/sql-wasm.js`,
`dist/sql-wasm.wasm`, and `LICENSE` over the vendored files, confirm
`sql-wasm.js` contains no `</script` or `<!--`, and update `VERSION`.

# exar1view

A browser tool for MR technologists to look inside Siemens `.exar1` files
(SQLite exports of one exam tree). Drop files onto the page, browse the tree
Region › Exam › Program laid out like Dot Cockpit, and compare the protocol
parameters of two measurement steps.

## Privacy

Files are read in this browser only. Nothing is uploaded or stored. Directory
passwords are never read.

## Using it

- **Open files.** Press **Open…** or drop `.exar1` files on the page. They load
  one after another (progress in the bottom right corner); a file that is
  already open is not loaded twice. A file that cannot be read is named in the
  red banner at the top.
- **Browse.** The dropdown at the top left lists the open files by name; pick
  one to show its Region › Exam › Program tree. Click a program (or use the
  arrow keys; Left/Right collapse and expand) to list its steps on the right.
  Select steps with click, Ctrl/Cmd-click, Shift-click or the arrow keys.
  Strategy and Decision forks show each branch under its choice (indented, the
  default marked), between the fork's Split and Join steps. ↪ marks a
  measurement with copy references (red when one is broken). The program's ⚠
  button lists its problems; a banner says when the step order could not be
  read and the steps are shown by rank instead. **Step facts** under the list
  shows the focused step's details (comment, tags, body part, contrast agent,
  copy references, problems); click its title to collapse it.
- **Split view** shows two panes side by side, each with its own file and
  selection.
- **Compare steps** shows only the protocol parameters that differ between two
  measurement steps: select both in one list (Ctrl/Cmd-click), or one in each
  pane of split view to compare across files, then press **Compare steps** (or
  right-click the step list). The panel at the bottom names both steps, says
  whether they have the same protocol, and lists the differing parameters (main
  protocol, then sub-protocols); "(absent = default)" means the protocol leaves
  that parameter at its default. Filter by parameter name. Churn parameters
  change whenever a protocol is scanned and re-saved (coils, adjustments,
  positions, scan time) and ignored ones never matter, so both are hidden until
  you tick **Show churn/ignored**. Escape or **Close** closes the panel; press
  **Compare steps** again to compare other steps. Protocols are read when
  compared, so an open file stays in memory until it is closed.
- **Search** filters the tree by region, exam, program and step names; a
  program whose steps match shows how many, and the matching steps are
  highlighted in its list. Escape clears the search.
- **Problems.** A ⚠ marks programs where something could not be read as
  expected (hover for the count). **Problems (n)** under the dropdown lists
  everything found in the file.
- **Close file** (under the dropdown, or right-click in the pane) removes the
  file from the page.

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

Writes `dist/exar1view.html`: the page with the CSS, sql.js (script and WASM) and
the bundled app inlined, plus a hash-based Content-Security-Policy, so it works
when opened from `file://` on an offline PC. The build fetches esbuild with
`npx`, so it needs network; `dist/` is not committed. `scripts/check-single.mjs`
runs after the build and offline: no external `src=`/`href=`, the embedded WASM
matches `vendor/sql.js/VERSION`, one CSP whose hashes match the inline code,
and size under 3 MB. Re-run it on its own to verify a copied file:
`node scripts/check-single.mjs dist/exar1view.html`. The build script is tested on Linux and macOS.

## Vendored code

`vendor/sql.js/` holds sql.js 1.14.2 (`sql-wasm.js`, `sql-wasm.wasm`, LICENSE) and
`vendor/fflate/` holds fflate 0.8.3 (`browser.js`, `browser.d.ts`, LICENSE), used
for raw-DEFLATE inflate. Each `VERSION` records the version, npm integrity string and sha256 of
both dist files; `npm test` checks the files against it. To update: in a fresh
empty directory run `npm pack sql.js@<version>`, extract it (run nothing from
it), copy `dist/sql-wasm.js`, `dist/sql-wasm.wasm` and `LICENSE` over the
vendored files, confirm `sql-wasm.js` has no `</script` or `<!--`, and update
`VERSION`.

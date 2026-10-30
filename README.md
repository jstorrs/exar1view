# exar1view

exar1view is a browser tool for MR technologists to inspect Siemens `.exar1`
exam trees, review protocols, compare measurement steps and programs, and
analyze sequence references before a software upgrade.

## Open the app

- [Use the hosted app](https://jstorrs.github.io/exar1view/)
- [Download the offline single-file app](https://jstorrs.github.io/exar1view/exar1view.html)

For offline use, save the linked HTML file and open it in a browser; no server
is needed.

## Privacy

Files are processed in your browser, with no uploads or persistent storage.
Analysis results remain only while the page is open.

## A quick start

1. Open or drop one or more `.exar1` files into the page.
2. Choose a file and browse its Region › Exam › Program tree; select a program
   to inspect its steps and protocols.
3. Compare selected steps or programs, or run **Analyze** and open the
   **Customer sequences report** to review sequence references and unchecked
   steps.

## What it does

- **Inspect:** browse exam trees, steps, protocol summaries, scanner cards,
  XProtocol, ASCCONV, add-ins, copy references, and problems.
- **Compare:** compare measurement steps by parameters or scanner cards, and
  compare programs with their step and fork changes.
- **Analyze:** find customer or unrecognised sequence references and export
  the report as CSV. Incomplete analysis is shown as **Not checked**.

See the [usage guide](docs/usage.md) for controls, comparison details, and the
full report behavior.

## Development

For local use, serve this folder with Python 3:

```sh
npm run serve
```

Then open <http://localhost:8000/>. Python 3 and Node.js/npm are prerequisites;
serving does not require installing npm packages.

```sh
npm test
npm run typecheck
npm run build
```

See [development and build notes](docs/development.md) for checks, confidential
test data, catalog maintenance, vendored code, and the offline build.

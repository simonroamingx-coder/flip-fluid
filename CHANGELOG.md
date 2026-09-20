# Versions

Newest first. Each release points at the document that describes it, so the
version number, the tag and the reasoning live in one place.

Cutting a release is described in [WORKFLOW.md](WORKFLOW.md).

## v1.1.0 - Settings and debug panel

**Planned, not started.** Specification: [docs/v1.1.0-settings-debug-panel.md](docs/v1.1.0-settings-debug-panel.md)

A Settings panel for the particle count (with Apply/Restart) and a Debug panel
for runtime statistics, profiling and debug visualisation. UI and instrumentation
only: the solver's maths is not meant to change.

- `tools/release.mjs` cuts a version in one command: bump `src/version.js`,
  rebuild, run the full verification, commit, tag, push, and publish a GitHub
  release with the generated `index.html` attached under a versioned name

## v1.0.0 - First versioned release

Tag: `v1.0.0`

- `src/version.js` holds the version, shown in the corner of the running
  simulation and stamped into the generated `index.html`
- `tools/verify.mjs` fails when HEAD carries a version tag that disagrees with
  `src/version.js`, so the badge cannot misreport what you are running
- The browser parity harness records the version badge and removes it before
  comparing, so the rest of the page is still checked exactly

## v1.0-refactor - The refactor

Tag: `v1.0-refactor`

The original single-file demo split into modules, verified byte-identical to
`ref/18-flip.html`:

- `src/core/FlipFluid.js` is a line-by-line port: same maths, same array
  layouts, same constants
- the root `index.html` is a generated single file that runs by double-click;
  `dev.html` plus `tools/serve.mjs` is the editable path
- `test/parity.mjs` (14 checks) and `test/parity-browser.mjs` (20 checks) proved
  the simulation state and the rendered output match the original exactly

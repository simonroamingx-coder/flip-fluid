# Versions

Newest first. Each release points at the document that describes it, so the
version number, the tag and the reasoning live in one place.

Cutting a release is described in [WORKFLOW.md](WORKFLOW.md).

## v1.2.0 - Display panel, and a release in two steps

**Ready to release.**

- The `Particles` and `Grid` checkboxes moved off the top row and into the display
  panel, so every view switch is in one place, which is what the specification
  asked for. They remain scene state - that is what the renderer reads - and they
  work with debug switched off; the three debug views are disabled until it is on.
  The top row is now solver options only.
- `tools/release.mjs` is two halves. `--prepare` does everything that needs no
  network: bump, rebuild, verify, commit, tag. `--publish` does everything that
  does: push, release. A push that fails used to leave the tool unable to finish
  that release at all, because the tag existed and the version checks refused to
  run again - which is exactly what happened when v1.1.0 was published, and had to
  be finished by hand.
- The browser harness no longer compares the page's DOM or its full-page
  screenshot against the original. That comparison belonged to the refactor and
  cannot survive a deliberate UI change; appendix C4 of the specification called
  this, and this is the release where it happened. The canvas, the simulation
  state and the control wiring are still compared exactly.

## v1.1.0 - Settings and debug panel

**Released 2026-09-21.** Specification: [docs/v1.1.0-settings-debug-panel.md](docs/v1.1.0-settings-debug-panel.md)

Everything the specification asks for:

- **Settings panel** with the particle count. The count is not a free parameter
  in this scenario, so `src/core/scenarios.js` solves for the grid resolution
  that produces it, and the panel reports what it actually got next to what was
  asked for. Applying rebuilds the scene in place and re-initialises the
  renderer, whose buffers are sized from the grid and the particle count.
- **Debug panel** with FPS, frame time, simulation and render time, particle
  counts and grid statistics. It collects nothing while it is switched off, it
  is refreshed about seven times a second rather than every frame, and every
  number comes from the solver's own arrays: `classifyCells()` was lifted out of
  `transferVelocities()` so that a statistic read while the simulation is paused
  describes the same classification the next step would make, instead of
  counting an unclassified grid. The solver still knows nothing about the panel.
- **Per-stage profiling**: particle update, particle to grid, pressure solve,
  grid to particle, collision, and everything else, inside the simulation total.
  `simulate()` takes an optional timing sink and measures its own stages with the
  sequence written once - a second copy of that sequence would be free to drift
  out of step and report times for operations that no longer happen in that
  order. With no sink, the cost is one boolean test per stage.
- **Debug views** over the simulation: pressure, read from `fluid.p` and shown as
  red intensity - how hard the solver is working in a cell, on a smoothed scale -
  and cell types, read from `fluid.cellType` - grey solid, blue fluid, near-black
  air. That is the grid exactly as the solver sees it, so it doubles as the
  collision view: the solid cells are the surfaces particles are pushed off.
  Both views only read the solver, take the place of the density grid while
  switched on, and are drawn as one textured quad over the grid and refreshed
  every frame - 56 updates a second at 58 fps, measured, against 60 fps with no
  view. Recomputing them at the panel's rate was the first attempt, and a field
  that steps seven times a second reads as stutter however cheap it is.
- **Velocity vectors**, sampled every fifth cell so a fine grid does not become a
  mat of arrows, each drawn from the centre of a fluid cell along the mean of the
  faces bounding it in the solver's own `u` and `v`. Vectors draw over whichever
  field is showing, which is the combination worth having. Sampling density and
  arrow length are the two knobs section 21 mentions; they are constants for now.
  Length is speed times a scale, capped: speeds here run from a median near 1 to
  a maximum near 8, and an uncapped linear scale either made the typical flow
  invisible or let a handful of cells draw lines across a third of the tank.
- **Advanced inspection**: the time step, grid resolution, pressure iterations,
  FLIP ratio and memory footprint, grouped as "Solver" in the panel.
  `FlipFluid.byteSize()` reports the solver's own array footprint by walking its
  own properties, so there is no list of arrays to keep in step with the code.
- `src/core/config.js` holds user settings, apart from the live scene state.
- The default path is untouched: with no configured count the scenario uses the
  original resolution, and the behaviour baseline still matches v1.0.0 field for
  field.
- `tools/release.mjs` cuts a version in one command: bump `src/version.js`,
  rebuild, run the full verification, commit, tag, push, and publish a GitHub
  release with the generated `index.html` attached under a versioned name.

Every acceptance criterion in section 40 is met, and each is backed by a check
rather than by having looked at it once.

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

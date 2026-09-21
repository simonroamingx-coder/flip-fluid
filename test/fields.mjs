// Do the debug views show the solver's own data, in the right places, and only
// read it?
//
//   node test/fields.mjs
//
// The views write a colour per cell into a buffer that is uploaded as a texture.
// Three things have to hold: the picture is derived from what the solver holds,
// it is laid out the way the texture expects, and drawing it cannot change the
// simulation. The last one is checked the same way as the profiler is - take a
// full snapshot of the state, write every view, compare.

import { AIR_CELL, FLUID_CELL, SOLID_CELL } from '../src/core/constants.js';
import {
    VELOCITY, createPressureRange, writeCellTypes, writePressureColors, writeVelocityVectors
} from '../src/debug/fields.js';
import { domainForViewport, loadRefactored, snapshot, stepRefactored } from './lib/harness.mjs';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const domain = domainForViewport();
const build = loadRefactored(domain.simWidth, domain.simHeight);

// Step it, so there is pressure and a cell classification to look at.
for (let step = 0; step < 10; step++)
    stepRefactored(build.scene);

const fluid = build.scene.fluid;
fluid.classifyCells();

const colors = new Uint8Array(3 * fluid.fNumCells);
const range = createPressureRange();

// Colours are written in texture order: one texel per cell, row by row, with y
// varying slowest. The solver indexes its cells the other way round, so both
// mappings are spelled out here once.
const texel = (xi, yi) => 3 * (yi * fluid.fNumX + xi);
const cellAt = (xi, yi) => xi * fluid.fNumY + yi;

// ------------------------------------------------- views must not write back

const before = snapshot(fluid, build.scene);
writePressureColors(fluid, colors, range);
writeCellTypes(fluid, colors);
const after = snapshot(fluid, build.scene);

const changed = Object.keys(before).filter(key => before[key] !== after[key]);
check('views only read the solver', changed.length === 0,
    changed.length ? `changed: ${changed.join(', ')}` : `${Object.keys(before).length} fields untouched`);

// ------------------------------------------------------------ the pressure view

// The colour scale is smoothed, so let it settle the way it would over a second
// of frames before judging the result.
for (let frame = 0; frame < 30; frame++)
    writePressureColors(fluid, colors, range);

let fluidCells = 0;
let coloured = 0;
let wrong = 0;
let brightest = 0;

for (let yi = 0; yi < fluid.fNumY; yi++) {
    for (let xi = 0; xi < fluid.fNumX; xi++) {
        const offset = texel(xi, yi);
        const cell = cellAt(xi, yi);
        const red = colors[offset];
        const green = colors[offset + 1];
        const blue = colors[offset + 2];

        if (red > 255 || green > 255 || blue > 255) {
            wrong++;
            continue;
        }

        if (fluid.cellType[cell] !== FLUID_CELL) {
            if (red || green || blue) wrong++;      // air and solid are not fluid
            continue;
        }

        fluidCells++;
        if (red || blue) coloured++;
        if (red > brightest) brightest = red;

        // Intensity in red, and only red: it tracks the size of the pressure,
        // whichever direction it is acting in. Nothing else is allowed to carry
        // colour, which is what the green and blue checks are for.
        if (green || blue) wrong++;
        const expected = Math.min(255, Math.round(255 * Math.abs(fluid.p[cell]) / range.peak));
        if (Math.abs(red - expected) > 1) wrong++;
    }
}

check('pressure view is red intensity, and only red', wrong === 0,
    wrong ? `${wrong} cells drawn wrong`
        : `${fluidCells} fluid cells, brightest ${brightest} of 255`);

check('pressure view is not blank', coloured > fluidCells * 0.2,
    `${coloured} of ${fluidCells} fluid cells carry a colour`);

check('pressure scale settles', range.peak > 0,
    `peak ${range.peak.toFixed(1)}`);

// ------------------------------------------------------- the cell type view

writeCellTypes(fluid, colors);

const SOLID = [158, 158, 158];
const FLUID = [38, 89, 255];
const AIR = [10, 13, 26];

const isColour = (offset, colour) => colors[offset] === colour[0]
    && colors[offset + 1] === colour[1]
    && colors[offset + 2] === colour[2];

const drawn = { solid: 0, fluid: 0, air: 0, other: 0 };

for (let yi = 0; yi < fluid.fNumY; yi++) {
    for (let xi = 0; xi < fluid.fNumX; xi++) {
        const offset = texel(xi, yi);
        if (isColour(offset, SOLID)) drawn.solid++;
        else if (isColour(offset, FLUID)) drawn.fluid++;
        else if (isColour(offset, AIR)) drawn.air++;
        else drawn.other++;
    }
}

const inGrid = { solid: 0, fluid: 0, air: 0 };

for (let i = 0; i < fluid.fNumCells; i++) {
    if (fluid.cellType[i] === SOLID_CELL) inGrid.solid++;
    else if (fluid.cellType[i] === FLUID_CELL) inGrid.fluid++;
    else inGrid.air++;
}

check('cell view draws every cell as its own type',
    drawn.other === 0
    && drawn.solid === inGrid.solid && drawn.fluid === inGrid.fluid && drawn.air === inGrid.air,
    `drawn ${drawn.solid} solid, ${drawn.fluid} fluid, ${drawn.air} air`
    + ` | grid ${inGrid.solid}, ${inGrid.fluid}, ${inGrid.air}`
    + (drawn.other ? ` | ${drawn.other} unrecognised` : ''));

// Orientation, checked without reusing the mapping above: setupScene makes the
// tank floor solid (row j = 0), so the first row of the texture has to be solid.
// If the writing order were transposed, that row would be a column instead and
// this would read as mostly fluid.
let floorSolid = 0;
for (let xi = 0; xi < fluid.fNumX; xi++) {
    if (isColour(3 * xi, SOLID))
        floorSolid++;
}

check('the field is the right way up', floorSolid === fluid.fNumX,
    `the first texture row is ${floorSolid} of ${fluid.fNumX} solid cells - the tank floor`);

// ------------------------------------------------------------- velocity vectors

const vertices = new Float32Array(4 * fluid.fNumCells);
const vectors = writeVelocityVectors(fluid, vertices);

let expected = 0;
let misplaced = 0;
let wrongLength = 0;
let moved = 0;

for (let xi = 1; xi < fluid.fNumX - 1; xi += VELOCITY.stride) {
    for (let yi = 1; yi < fluid.fNumY - 1; yi += VELOCITY.stride) {
        if (fluid.cellType[cellAt(xi, yi)] === FLUID_CELL)
            expected++;
    }
}

check('vectors are sampled, not one per cell', vectors === expected && vectors > 0 && vectors < fluid.fNumCells / 4,
    `${vectors} vectors from ${fluid.fNumCells} cells, stride ${VELOCITY.stride}`);

for (let index = 0; index < vectors; index++) {
    const offset = 4 * index;
    const x1 = vertices[offset];
    const y1 = vertices[offset + 1];
    const x2 = vertices[offset + 2];
    const y2 = vertices[offset + 3];

    // Starts at the centre of a fluid cell: the arrow belongs to a cell the solver
    // actually has a velocity for.
    const xi = Math.round(x1 / fluid.h - 0.5);
    const yi = Math.round(y1 / fluid.h - 0.5);
    if (fluid.cellType[cellAt(xi, yi)] !== FLUID_CELL)
        misplaced++;

    // Length is the cell's velocity times the display scale, where the cell's
    // velocity is the mean of the two faces bounding it in each direction.
    const cell = cellAt(xi, yi);
    const ux = 0.5 * (fluid.u[cell] + fluid.u[(xi + 1) * fluid.fNumY + yi]);
    const vy = 0.5 * (fluid.v[cell] + fluid.v[cell + 1]);
    const speed = Math.hypot(ux, vy);
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (Math.abs(length - speed * VELOCITY.scale) > 1e-4)
        wrongLength++;
    if (length > 1e-6)
        moved++;
}

check('vectors belong to fluid cells', misplaced === 0,
    `${vectors} vectors, ${expected} fluid cells sampled, ${misplaced} misplaced`);

check('vector length is speed times the scale', wrongLength === 0,
    wrongLength ? `${wrongLength} vectors with the wrong length` : `scale ${VELOCITY.scale}`);

check('the vectors show motion', moved > vectors * 0.2,
    `${moved} of ${vectors} vectors have a length`);

// ------------------------------------------------------------------- report

function fmt(label, value, ok)
{
    const padding = ' '.repeat(Math.max(0, 36 - label.length));
    return `${label}${padding}${value}${ok ? '' : '   <-- FAIL'}`;
}

console.log('');
console.log('debug views over the solver data, ' + fluid.fNumX + 'x' + fluid.fNumY + ' cells');
console.log('');
console.log(fmt('check', 'detail', true));
console.log('-'.repeat(100));

for (const result of results)
    console.log(fmt(result.name, result.detail, result.ok));

console.log('-'.repeat(100));

const failed = results.filter(result => !result.ok);

console.log('');
if (failed.length) {
    console.log(`RESULT: FAIL - ${failed.length} of ${results.length} checks failed`);
    process.exitCode = 1;
} else {
    console.log(`RESULT: PASS - all ${results.length} checks match`);
}

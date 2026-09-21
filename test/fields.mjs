// Do the debug views show the solver's own data, and only read it?
//
//   node test/fields.mjs
//
// The views are a colour mapping over fluid.p and fluid.cellType. Two things
// have to hold: the picture is derived from what the solver actually holds, and
// drawing it cannot change the simulation. The second one is checked the same
// way as the profiler is: take a full snapshot of the state, write every view,
// and compare.

import { AIR_CELL, FLUID_CELL, SOLID_CELL } from '../src/core/constants.js';
import { writePressureColors, writeCellTypes } from '../src/debug/fields.js';
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

const colors = new Float32Array(3 * fluid.fNumCells);

// ------------------------------------------------- views must not write back

const before = snapshot(fluid, build.scene);
writePressureColors(fluid, colors);
writeCellTypes(fluid, colors);
const after = snapshot(fluid, build.scene);

const changed = Object.keys(before).filter(key => before[key] !== after[key]);
check('views only read the solver', changed.length === 0,
    changed.length ? `changed: ${changed.join(', ')}` : `${Object.keys(before).length} fields untouched`);

// ------------------------------------------------------------ the pressure view

writePressureColors(fluid, colors);

let fluidCells = 0;
let positive = 0;
let negative = 0;
let coloured = 0;
let wrong = 0;

for (let i = 0; i < fluid.fNumCells; i++) {
    const offset = 3 * i;
    const red = colors[offset];
    const green = colors[offset + 1];
    const blue = colors[offset + 2];

    if (red < 0 || red > 1 || green < 0 || green > 1 || blue < 0 || blue > 1) {
        wrong++;
        continue;
    }

    if (fluid.cellType[i] !== FLUID_CELL) {
        if (red || green || blue) wrong++;      // air and solid are not fluid
        continue;
    }

    fluidCells++;
    if (red || blue) coloured++;

    // Sign is what the view is for: pushing is red, pulling is blue.
    if (fluid.p[i] > 0) { positive++; if (!(red > 0 && blue === 0)) wrong++; }
    if (fluid.p[i] < 0) { negative++; if (!(blue > 0 && red === 0)) wrong++; }
}

check('pressure view is in range and signed', wrong === 0,
    wrong ? `${wrong} cells drawn wrong` : `${fluidCells} fluid cells, ${positive} pushing, ${negative} pulling`);

check('pressure view is not blank', coloured > fluidCells * 0.2,
    `${coloured} of ${fluidCells} fluid cells carry a colour`);

// ------------------------------------------------------- the cell type view

writeCellTypes(fluid, colors);

let solids = 0;
let air = 0;
let fluids = 0;
let mismatched = 0;

for (let i = 0; i < fluid.fNumCells; i++) {
    const offset = 3 * i;
    const red = colors[offset];
    const blue = colors[offset + 2];

    if (fluid.cellType[i] === SOLID_CELL) {
        solids++;
        if (Math.abs(red - blue) > 0.01) mismatched++;       // grey: red equals blue
    } else if (fluid.cellType[i] === FLUID_CELL) {
        fluids++;
        if (!(blue > red)) mismatched++;                     // fluid is blue
    } else {
        air++;
        if (!(red < 0.2 && blue < 0.2)) mismatched++;        // air is nearly black
    }
}

check('cell view separates the three types', mismatched === 0 && solids > 0 && fluids > 0 && air > 0,
    mismatched ? `${mismatched} cells drawn as the wrong type`
        : `${solids} solid, ${fluids} fluid, ${air} air`);

check('solid cells match the solver', solids === [...fluid.cellType].filter(type => type === SOLID_CELL).length,
    'every solid cell in the grid is drawn as one');

// ------------------------------------------------------------------- report

function fmt(label, value, ok)
{
    const padding = ' '.repeat(Math.max(0, 34 - label.length));
    return `${label}${padding}${value}${ok ? '' : '   <-- FAIL'}`;
}

console.log('');
console.log('debug views over the solver data');
console.log('');
console.log(fmt('check', 'detail', true));
console.log('-'.repeat(96));

for (const result of results)
    console.log(fmt(result.name, result.detail, result.ok));

console.log('-'.repeat(96));

const failed = results.filter(result => !result.ok);

console.log('');
if (failed.length) {
    console.log(`RESULT: FAIL - ${failed.length} of ${results.length} checks failed`);
    process.exitCode = 1;
} else {
    console.log(`RESULT: PASS - all ${results.length} checks match`);
}

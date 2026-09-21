// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.
//
// Colour mappings for the debug views. Each one reads a solver array - fluid.p
// for pressure, fluid.cellType for the cell view - and writes RGB into a buffer
// the renderer uploads. Nothing here is a second simulation, and nothing here
// writes back into the solver.

import { FLUID_CELL, SOLID_CELL } from '../core/constants.js';

// The colour arrays are uploaded as a texture, one texel per cell, so they have
// to be written in texture order - row by row, with y varying slowest. The solver
// stores its cells the other way round (index = x * fNumY + y, x varying slowest),
// so this mapping lives here rather than being spelled out at each use. Getting it
// backwards is not subtle: every field comes out transposed.
function texelOffset(fluid, xi, yi)
{
    return 3 * (yi * fluid.fNumX + xi);
}

// Pressure is signed, so it is mapped diverging around zero: blue where the
// solver is pulling, red where it is pushing, dark at rest. That is a different
// question from the density ramp the grid view draws, which is why it is not the
// same mapping. Each side is scaled to its own largest value, so a field that is
// mostly one sign still uses the whole colour range instead of washing out.
// The scale is smoothed rather than recomputed flat, because the whole field
// gets brighter or darker whenever the peak moves, and a peak that jumps every
// frame makes the picture flicker. Rising fast so a real spike is visible,
// falling slowly so the field settles instead of strobing.
const RISE = 0.25;
const FALL = 0.01;

export function createPressureRange()
{
    return { positive: 0, negative: 0 };
}

export function writePressureColors(fluid, colors, range)
{
    let mostPositive = 0;
    let mostNegative = 0;

    for (let i = 0; i < fluid.fNumCells; i++) {
        if (fluid.cellType[i] !== FLUID_CELL)
            continue;

        if (fluid.p[i] > mostPositive)
            mostPositive = fluid.p[i];
        if (-fluid.p[i] > mostNegative)
            mostNegative = -fluid.p[i];
    }

    range.positive += (mostPositive - range.positive) * (mostPositive > range.positive ? RISE : FALL);
    range.negative += (mostNegative - range.negative) * (mostNegative > range.negative ? RISE : FALL);

    for (let yi = 0; yi < fluid.fNumY; yi++) {
        for (let xi = 0; xi < fluid.fNumX; xi++) {
            const cell = xi * fluid.fNumY + yi;
            const offset = texelOffset(fluid, xi, yi);

            if (fluid.cellType[cell] !== FLUID_CELL) {
                colors[offset] = 0;
                colors[offset + 1] = 0;
                colors[offset + 2] = 0;
                continue;
            }

            const pressure = fluid.p[cell];
            colors[offset] = pressure > 0 && range.positive
                ? Math.min(255, Math.round(255 * pressure / range.positive))
                : 0;
            colors[offset + 1] = 0;
            colors[offset + 2] = pressure < 0 && range.negative
                ? Math.min(255, Math.round(255 * -pressure / range.negative))
                : 0;
        }
    }
}

// Solid cells - the walls and wherever the disc is - fluid cells, and the air
// between them. This is the grid as the solver sees it, so it doubles as the
// collision view: the solid cells are the surfaces particles are pushed off.
export function writeCellTypes(fluid, colors)
{
    for (let yi = 0; yi < fluid.fNumY; yi++) {
        for (let xi = 0; xi < fluid.fNumX; xi++) {
            const offset = texelOffset(fluid, xi, yi);
            const type = fluid.cellType[xi * fluid.fNumY + yi];

            if (type === SOLID_CELL) {
                colors[offset] = 158;
                colors[offset + 1] = 158;
                colors[offset + 2] = 158;
            } else if (type === FLUID_CELL) {
                colors[offset] = 38;
                colors[offset + 1] = 89;
                colors[offset + 2] = 255;
            } else {
                colors[offset] = 10;
                colors[offset + 1] = 13;
                colors[offset + 2] = 26;
            }
        }
    }
}

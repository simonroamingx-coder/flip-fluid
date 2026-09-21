// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.
//
// Colour mappings for the debug views. Each one reads a solver array - fluid.p
// for pressure, fluid.cellType for the cell view - and writes RGB into a buffer
// the renderer uploads. Nothing here is a second simulation, and nothing here
// writes back into the solver.

import { FLUID_CELL, SOLID_CELL } from '../core/constants.js';

// Pressure is signed, so it is mapped diverging around zero: blue where the
// solver is pulling, red where it is pushing, dark at rest. That is a different
// question from the density ramp the grid view draws, which is why it is not the
// same mapping. Each side is scaled to its own largest value, so a field that is
// mostly one sign still uses the whole colour range instead of washing out.
export function writePressureColors(fluid, colors)
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

    for (let i = 0; i < fluid.fNumCells; i++) {
        const offset = 3 * i;

        if (fluid.cellType[i] !== FLUID_CELL) {
            colors[offset] = 0;
            colors[offset + 1] = 0;
            colors[offset + 2] = 0;
            continue;
        }

        const pressure = fluid.p[i];
        colors[offset] = pressure > 0 && mostPositive ? pressure / mostPositive : 0;
        colors[offset + 1] = 0;
        colors[offset + 2] = pressure < 0 && mostNegative ? -pressure / mostNegative : 0;
    }
}

// Solid cells - the walls and wherever the disc is - fluid cells, and the air
// between them. This is the grid as the solver sees it, so it doubles as the
// collision view: the solid cells are the surfaces particles are pushed off.
export function writeCellTypes(fluid, colors)
{
    for (let i = 0; i < fluid.fNumCells; i++) {
        const offset = 3 * i;
        const type = fluid.cellType[i];

        if (type === SOLID_CELL) {
            colors[offset] = 0.62;
            colors[offset + 1] = 0.62;
            colors[offset + 2] = 0.62;
        } else if (type === FLUID_CELL) {
            colors[offset] = 0.15;
            colors[offset + 1] = 0.35;
            colors[offset + 2] = 1.0;
        } else {
            colors[offset] = 0.04;
            colors[offset + 1] = 0.05;
            colors[offset + 2] = 0.10;
        }
    }
}

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

// Pressure is shown as magnitude: red intensity is how hard the solver is working
// in a cell, whichever direction it is working in.
//
// The value is signed - the solver pushes where the fluid is compressed and pulls
// where it is stretched - and the first version of this drew the sign, red for
// pushing and blue for pulling. It reads better as one colour, because the
// negative side is not physical in this solver: there is no free-surface pressure
// boundary condition and no cavitation model, so a separate colour would lend the
// suction more meaning than it has. If the sign is ever wanted back, it is the two
// lines that write a blue channel from the negative values.
//
// The scale is smoothed rather than recomputed flat, because the whole field gets
// brighter or darker whenever the peak moves, and a peak that jumps every frame
// makes the picture flicker. Rising fast so a real spike is visible, falling
// slowly so the field settles instead of strobing.
const RISE = 0.25;
const FALL = 0.01;

export function createPressureRange()
{
    return { peak: 0 };
}

export function writePressureColors(fluid, colors, range)
{
    let peak = 0;

    for (let i = 0; i < fluid.fNumCells; i++) {
        if (fluid.cellType[i] !== FLUID_CELL)
            continue;

        const magnitude = Math.abs(fluid.p[i]);
        if (magnitude > peak)
            peak = magnitude;
    }

    range.peak += (peak - range.peak) * (peak > range.peak ? RISE : FALL);

    for (let yi = 0; yi < fluid.fNumY; yi++) {
        for (let xi = 0; xi < fluid.fNumX; xi++) {
            const cell = xi * fluid.fNumY + yi;
            const offset = texelOffset(fluid, xi, yi);
            const magnitude = Math.abs(fluid.p[cell]);

            colors[offset] = fluid.cellType[cell] === FLUID_CELL && range.peak
                ? Math.min(255, Math.round(255 * magnitude / range.peak))
                : 0;
            colors[offset + 1] = 0;
            colors[offset + 2] = 0;
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

// Velocity vectors, sampled on a stride so a fine grid does not turn into a mat
// of arrows, and drawn from the cell centre outwards along the average of the
// faces that bound it. In this solver u lives on the left face of a cell and v on
// the bottom one, so the cell's own velocity is the mean of its two faces in each
// direction. Only fluid cells get one: an arrow floating in the air would be a
// velocity the solver never computed.
// Sampling density and arrow length. These are the two knobs section 21 of the
// specification mentions; they are constants for now, and would be sliders if
// the view grew a settings row of its own.
export const VELOCITY = { stride: 5, scale: 0.2 };

export function writeVelocityVectors(fluid, vertices, options = VELOCITY)
{
    const n = fluid.fNumY;
    const h = fluid.h;
    let written = 0;
    let vectors = 0;

    for (let xi = 1; xi < fluid.fNumX - 1; xi += options.stride) {
        for (let yi = 1; yi < fluid.fNumY - 1; yi += options.stride) {
            const cell = xi * n + yi;
            if (fluid.cellType[cell] !== FLUID_CELL)
                continue;

            const ux = 0.5 * (fluid.u[cell] + fluid.u[(xi + 1) * n + yi]);
            const vy = 0.5 * (fluid.v[cell] + fluid.v[cell + 1]);

            const x = (xi + 0.5) * h;
            const y = (yi + 0.5) * h;

            vertices[written++] = x;
            vertices[written++] = y;
            vertices[written++] = x + ux * options.scale;
            vertices[written++] = y + vy * options.scale;
            vectors++;
        }
    }

    return vectors;
}

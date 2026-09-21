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
// Sampling density, arrow length per unit of speed, and a cap on that length.
// Speeds here are spread widely - the median is around 1 while the fastest cells
// reach 8 - so one linear scale cannot serve both ends: shorten it until the fast
// arrows are sane and the typical flow disappears, or leave it and a handful of
// cells draw lines across a third of the tank. The cap leaves the middle of the
// distribution linear and stops the tail from dominating. Cells above the cap all
// draw the same length, so the picture reads as direction with the magnitude
// readable up to the cap and not beyond.
//
// Constants rather than panel controls, which section 21 allows for.
export const VELOCITY = { stride: 5, scale: 0.05, cap: 0.2 };

// The layout contract between the writer below and the renderer that uploads it:
// one line segment per vector, two vertices, two floats per vertex. It lives here
// because two modules have to agree on it, and when they were each deriving it
// separately the renderer drew half the vectors - exactly the left half of the
// tank, in scan order.
export const VERTICES_PER_VECTOR = 2;
export const FLOATS_PER_VERTEX = 2;
export const FLOATS_PER_VECTOR = VERTICES_PER_VECTOR * FLOATS_PER_VERTEX;

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

            // Direction is the velocity's; only its length is capped.
            const speed = Math.hypot(ux, vy);
            const length = Math.min(speed * options.scale, options.cap);
            const factor = speed > 0 ? length / speed : 0;

            vertices[written++] = x;
            vertices[written++] = y;
            vertices[written++] = x + ux * factor;
            vertices[written++] = y + vy * factor;
            vectors++;
        }
    }

    return vectors;
}

// ------------------------------------------------------- particle colour modes

// What the particles are coloured by. Density is the solver's own scheme, which
// stays untouched so the default view is exactly what it always was; the other
// three are computed here from the solver's arrays and drawn instead of it.
export const PARTICLE_MODES = ['density', 'speed', 'pressure', 'vorticity'];

export function createParticleRange()
{
    return { peak: 0 };
}

// A ramp rather than an intensity, because these are drawn as small dots: red at
// full brightness next to red at half is hard to tell apart at four pixels,
// whereas blue through cyan and yellow to red is not.
const RAMP = [
    [40, 60, 200],
    [40, 200, 220],
    [235, 215, 70],
    [240, 80, 40]
];

// Written as 0..1, not 0..255: this goes into a Float32 buffer the shader reads as
// a colour, unlike the cell views, which are Uint8 textures. Writing 0..255 here
// makes every particle white, and every mode look the same.
function writeRamp(value, colors, offset)
{
    const scaled = Math.max(0, Math.min(1, value)) * (RAMP.length - 1);
    const index = Math.min(RAMP.length - 2, Math.floor(scaled));
    const t = scaled - index;

    for (let channel = 0; channel < 3; channel++) {
        const from = RAMP[index][channel] / 255;
        const to = RAMP[index + 1][channel] / 255;
        colors[offset + channel] = from + (to - from) * t;
    }
}

// The curl of the velocity field at a cell, from the same face velocities the
// solver uses. Positive and negative mean opposite directions of rotation; only
// the size is shown, the way the pressure view settled on magnitude too.
function vorticityAt(fluid, xi, yi)
{
    const n = fluid.fNumY;
    const x = Math.min(Math.max(xi, 1), fluid.fNumX - 2);
    const y = Math.min(Math.max(yi, 1), fluid.fNumY - 2);
    const twoH = 2 * fluid.h;

    return (fluid.v[(x + 1) * n + y] - fluid.v[(x - 1) * n + y]) / twoH
        - (fluid.u[x * n + y + 1] - fluid.u[x * n + y - 1]) / twoH;
}

// One colour per particle for the chosen mode, into a buffer the renderer uploads
// in place of the solver's particleColor. The peak is smoothed, so the picture does
// not strobe as the range of the quantity moves.
export function writeParticleColors(fluid, colors, mode, range, scratch)
{
    const n = fluid.fNumY;
    const h1 = fluid.fInvSpacing;
    const values = scratch;
    let peak = 0;

    for (let i = 0; i < fluid.numParticles; i++) {
        let value;

        if (mode === 'speed') {
            value = Math.hypot(fluid.particleVel[2 * i], fluid.particleVel[2 * i + 1]);
        } else {
            const xi = Math.min(fluid.fNumX - 1, Math.max(0, Math.floor(fluid.particlePos[2 * i] * h1)));
            const yi = Math.min(fluid.fNumY - 1, Math.max(0, Math.floor(fluid.particlePos[2 * i + 1] * h1)));
            value = mode === 'pressure'
                ? Math.abs(fluid.p[xi * n + yi])
                : Math.abs(vorticityAt(fluid, xi, yi));
        }

        values[i] = value;
        if (value > peak)
            peak = value;
    }

    range.peak += (peak - range.peak) * (peak > range.peak ? 0.25 : 0.01);
    const scale = range.peak > 0 ? 1 / range.peak : 0;

    for (let i = 0; i < fluid.numParticles; i++) {
        // A square root, so the middle of the range is not squeezed into the bottom
        // of the ramp: these quantities are as skewed as the solver's speeds are.
        writeRamp(Math.sqrt(values[i] * scale), colors, 3 * i);
    }
}

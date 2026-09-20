// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.

import { FlipFluid } from './FlipFluid.js';
import { setObstacle } from './obstacle.js';

// The grid resolution the original used. With no configuration this is what
// setupScene uses, which keeps the default behaviour identical to v1.0.0 - the
// behaviour baseline is what proves that.
export const DEFAULT_RESOLUTION = 100;

const REL_WATER_WIDTH = 0.6;
const REL_WATER_HEIGHT = 0.8;
const PARTICLE_RADIUS_PER_CELL = 0.3;

// Particle count is not a free parameter here: it falls out of the tank size,
// the grid resolution, the particle radius (0.3 of a cell) and the water block
// proportions. So asking for a count means solving for the resolution that
// produces it. That keeps the block shape and the particle-to-cell ratio - and
// therefore the character of the simulation - unchanged.
export function particleCountAt(resolution, simWidth, simHeight)
{
    const tankHeight = 1.0 * simHeight;
    const tankWidth = 1.0 * simWidth;
    const h = tankHeight / resolution;
    const r = PARTICLE_RADIUS_PER_CELL * h;
    const dx = 2.0 * r;
    const dy = Math.sqrt(3.0) / 2.0 * dx;

    const numX = Math.floor((REL_WATER_WIDTH * tankWidth - 2.0 * h - 2.0 * r) / dx);
    const numY = Math.floor((REL_WATER_HEIGHT * tankHeight - 2.0 * h - 2.0 * r) / dy);
    return numX * numY;
}

// Count grows with the square of the resolution. Take that as an estimate, then
// compare the resolutions around it and return the closest achievable count -
// the lattice is hexagonal, so only particular counts exist and the caller has
// to be told what it actually got.
export function resolutionForParticleCount(target, simWidth, simHeight)
{
    const base = particleCountAt(DEFAULT_RESOLUTION, simWidth, simHeight);
    const estimate = Math.max(2, Math.round(DEFAULT_RESOLUTION * Math.sqrt(target / base)));

    let best = estimate;
    let bestDelta = Infinity;

    for (let resolution = Math.max(2, estimate - 4); resolution <= estimate + 4; resolution++) {
        const delta = Math.abs(particleCountAt(resolution, simWidth, simHeight) - target);
        if (delta < bestDelta) {
            bestDelta = delta;
            best = resolution;
        }
    }

    return best;
}

// Dam break: a block of water in the left part of the tank, plus the disc.
// This is a line-by-line port of setupScene() in the original file.
export function setupScene(scene, simWidth, simHeight, config = null)
{
    scene.obstacleRadius = 0.15;
    scene.overRelaxation = 1.9;

    scene.dt = 1.0 / 60.0;
    scene.numPressureIters = 50;
    scene.numParticleIters = 2;

    const requested = config && config.particleCount ? config.particleCount : null;
    const res = requested === null
        ? DEFAULT_RESOLUTION
        : resolutionForParticleCount(requested, simWidth, simHeight);

    scene.requestedParticles = requested;
    scene.gridResolution = res;

    const tankHeight = 1.0 * simHeight;
    const tankWidth = 1.0 * simWidth;
    const h = tankHeight / res;
    const density = 1000.0;

    const relWaterHeight = REL_WATER_HEIGHT;
    const relWaterWidth = REL_WATER_WIDTH;

    // compute number of particles

    const r = PARTICLE_RADIUS_PER_CELL * h;    // particle radius w.r.t. cell size
    const dx = 2.0 * r;
    const dy = Math.sqrt(3.0) / 2.0 * dx;

    const numX = Math.floor((relWaterWidth * tankWidth - 2.0 * h - 2.0 * r) / dx);
    const numY = Math.floor((relWaterHeight * tankHeight - 2.0 * h - 2.0 * r) / dy);
    const maxParticles = numX * numY;

    // create fluid

    const f = scene.fluid = new FlipFluid(density, tankWidth, tankHeight, h, r, maxParticles);

    // create particles

    f.numParticles = numX * numY;
    let p = 0;
    for (let i = 0; i < numX; i++) {
        for (let j = 0; j < numY; j++) {
            f.particlePos[p++] = h + r + dx * i + (j % 2 == 0 ? 0.0 : r);
            f.particlePos[p++] = h + r + dy * j;
        }
    }

    // setup grid cells for tank

    const n = f.fNumY;

    for (let i = 0; i < f.fNumX; i++) {
        for (let j = 0; j < f.fNumY; j++) {
            let s = 1.0;    // fluid
            if (i == 0 || i == f.fNumX - 1 || j == 0)
                s = 0.0;    // solid
            f.s[i * n + j] = s;
        }
    }

    setObstacle(scene, 3.0, 2.0, true);

    // The lattice is discrete, so this is what the request actually produced.
    scene.actualParticles = f.numParticles;
}

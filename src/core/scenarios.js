// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.

import { FlipFluid } from './FlipFluid.js';
import { setObstacle } from './obstacle.js';

// Dam break: a block of water in the left part of the tank, plus the disc.
// This is a line-by-line port of setupScene() in the original file.
export function setupScene(scene, simWidth, simHeight)
{
    scene.obstacleRadius = 0.15;
    scene.overRelaxation = 1.9;

    scene.dt = 1.0 / 60.0;
    scene.numPressureIters = 50;
    scene.numParticleIters = 2;

    const res = 100;

    const tankHeight = 1.0 * simHeight;
    const tankWidth = 1.0 * simWidth;
    const h = tankHeight / res;
    const density = 1000.0;

    const relWaterHeight = 0.8;
    const relWaterWidth = 0.6;

    // compute number of particles

    const r = 0.3 * h;    // particle radius w.r.t. cell size
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
}

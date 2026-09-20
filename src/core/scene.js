// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.

// All values match the object literal in the original file exactly.
// setupScene() overrides some of them (dt, iteration counts) at startup,
// which is also what the original did.
export function createScene()
{
    return {
        gravity: -9.81,
        dt: 1.0 / 120.0,
        flipRatio: 0.9,
        numPressureIters: 100,
        numParticleIters: 2,
        frameNr: 0,
        overRelaxation: 1.9,
        compensateDrift: true,
        separateParticles: true,
        obstacleX: 0.0,
        obstacleY: 0.0,
        obstacleRadius: 0.15,
        paused: true,
        showObstacle: true,
        obstacleVelX: 0.0,
        obstacleVelY: 0.0,
        showParticles: true,
        showGrid: false,
        fluid: null
    };
}

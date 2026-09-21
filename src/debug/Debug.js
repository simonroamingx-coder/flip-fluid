// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.
//
// Runtime statistics for the debug panel. Three rules shape this file:
//
//   - the solver never knows it exists, and this never touches the DOM
//   - nothing is collected while it is disabled, so a normal run costs nothing
//   - the numbers come from the solver's own arrays; there is no second
//     representation of the simulation built just to display it
//
// The panel formats what is here. It does not compute anything.

import { FLUID_CELL } from '../core/constants.js';

export function createRuntimeStats()
{
    return {
        fps: 0,
        frameTime: 0,

        simulationTime: 0,
        renderTime: 0,

        // What the simulation spent itself on, as the solver reports it
        particleTime: 0,
        particleToGridTime: 0,
        pressureTime: 0,
        gridToParticleTime: 0,
        collisionTime: 0,
        otherTime: 0,

        particleCount: 0,
        activeParticles: 0,
        gridCells: 0,
        fluidCells: 0
    };
}

// The sink the solver writes its stage times into. It is cleared before every
// step, so the panel shows what one frame cost rather than a running total.
export function createTimings()
{
    return {
        particleTime: 0,
        particleToGridTime: 0,
        pressureTime: 0,
        gridToParticleTime: 0,
        collisionTime: 0,
        otherTime: 0
    };
}

// Frame time is smoothed, because a raw reading swings too widely to read:
// 60, 59, 42, 60, 38. Nothing is hidden by this, it is the same number with the
// jitter taken out.
const SMOOTHING = 0.1;

export function createDebug()
{
    const stats = createRuntimeStats();
    const timings = createTimings();
    let enabled = false;
    let previousFrame = 0;
    let smoothedFrameTime = 0;

    function zeroTimings()
    {
        for (const key in timings)
            timings[key] = 0;
    }

    function reset()
    {
        Object.assign(stats, createRuntimeStats());
        zeroTimings();
        previousFrame = 0;
        smoothedFrameTime = 0;
    }

    function beginStep()
    {
        zeroTimings();
    }

    // Called once per animation frame, and only while enabled.
    function recordStep({ now, simulationTime, renderTime })
    {
        if (previousFrame) {
            const frameTime = now - previousFrame;
            smoothedFrameTime = smoothedFrameTime
                ? smoothedFrameTime + (frameTime - smoothedFrameTime) * SMOOTHING
                : frameTime;

            stats.frameTime = smoothedFrameTime;
            stats.fps = smoothedFrameTime > 0 ? 1000 / smoothedFrameTime : 0;
        }
        previousFrame = now;

        stats.simulationTime = simulationTime;
        stats.renderTime = renderTime;

        for (const key in timings)
            stats[key] = timings[key];
    }

    // Read from the solver's grid as it stands. This walks the cell array, so it
    // is called when the panel refreshes rather than on every frame.
    function refreshCounts(scene)
    {
        const fluid = scene.fluid;
        if (!fluid)
            return;

        // The classification lives in the solver and only exists once a step has
        // run, so it is brought up to date here rather than read as a grid of
        // zeros - which would count every cell as fluid.
        fluid.classifyCells();

        let fluidCells = 0;
        for (let i = 0; i < fluid.fNumCells; i++) {
            if (fluid.cellType[i] === FLUID_CELL)
                fluidCells++;
        }

        stats.particleCount = fluid.maxParticles;
        stats.activeParticles = fluid.numParticles;
        stats.gridCells = fluid.fNumCells;
        stats.fluidCells = fluidCells;
    }

    return {
        stats,
        timings,

        get enabled()
        {
            return enabled;
        },

        setEnabled(value)
        {
            enabled = Boolean(value);
            if (!enabled)
                reset();
        },

        reset,
        beginStep,
        recordStep,
        refreshCounts
    };
}

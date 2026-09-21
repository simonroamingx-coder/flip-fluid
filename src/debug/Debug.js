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
import { createPressureRange, writePressureColors, writeCellTypes } from './fields.js';

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

    // Which of the debug views is showing. Kept here rather than read from the
    // configuration each frame, so the renderer is never asking the UI anything.
    let views = { pressure: false, cellTypes: false };
    let pressureColors = null;
    let cellTypeColors = null;
    const pressureRange = createPressureRange();
    let fieldUpdates = 0;

    function zeroTimings()
    {
        for (const key in timings)
            timings[key] = 0;
    }

    function reset()
    {
        Object.assign(stats, createRuntimeStats());
        zeroTimings();
        pressureRange.peak = 0;
        fieldUpdates = 0;
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

    function ensureBuffers(fluid)
    {
        const needed = 3 * fluid.fNumCells;
        if (pressureColors && pressureColors.length === needed)
            return;

        pressureColors = new Uint8Array(needed);
        cellTypeColors = new Uint8Array(needed);
    }

    // Recomputes the colour buffer for whichever view is on. This runs every
    // frame, not at the panel's refresh rate: a field that steps a few times a
    // second reads as stutter, and the upload that follows is one quad rather
    // than one sprite per cell. The cost is a single pass over the cells, and
    // only while a view is switched on.
    //
    // Cells are classified first, so a view switched on while the simulation is
    // paused describes the grid the next step would use rather than an empty one.
    function updateField(scene)
    {
        const fluid = scene && scene.fluid;
        if (!fluid || !enabled || (!views.pressure && !views.cellTypes))
            return;

        fluid.classifyCells();
        ensureBuffers(fluid);

        if (views.pressure)
            writePressureColors(fluid, pressureColors, pressureRange);
        if (views.cellTypes)
            writeCellTypes(fluid, cellTypeColors);

        fieldUpdates++;
    }

    // What the renderer should draw over the simulation, if anything. The buffer
    // length is checked because rebuilding the scene changes the cell count, and
    // a stale buffer would be uploaded for the wrong number of vertices.
    function fieldView(scene)
    {
        if (!enabled || !scene.fluid)
            return null;

        const colors = views.pressure ? pressureColors : views.cellTypes ? cellTypeColors : null;
        if (!colors || colors.length !== 3 * scene.fluid.fNumCells)
            return null;

        return { colors };
    }

    return {
        stats,
        timings,

        get views()
        {
            return { ...views };
        },

        // How many times the field has been recomputed. It is here so a test can
        // tell "every frame" from "a few times a second".
        get fieldUpdates()
        {
            return fieldUpdates;
        },

        setViews(value)
        {
            views = { pressure: Boolean(value.pressure), cellTypes: Boolean(value.cellTypes) };
            if (!enabled)
                views = { pressure: false, cellTypes: false };
        },

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
        refreshCounts,
        updateField,
        fieldView
    };
}

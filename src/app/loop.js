// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.

// One simulation step. Note that frameNr is incremented on every call, including
// when the scene is paused - that matches the original function, where the
// increment sat outside the `if (!scene.paused)` guard.
export function simulateOnce(scene, timings = null)
{
    if (!scene.paused)
        scene.fluid.simulate(
            scene.dt, scene.gravity, scene.flipRatio, scene.numPressureIters, scene.numParticleIters,
            scene.overRelaxation, scene.compensateDrift, scene.separateParticles,
            scene.obstacleX, scene.obstacleY, scene.obstacleRadius,
            scene.obstacleVelX, scene.obstacleVelY, timings);

    scene.frameNr++;
}

// The frame loop. It owns the two stages it can measure - simulation and render -
// and nothing else. Statistics are collected only while debug is enabled, and the
// panel behind them is refreshed at a fixed rate instead of every frame, because
// the simulation runs at 60 Hz and no one needs the DOM updated that often.
export function startLoop({ scene, drawFrame, debug, onSample, sampleIntervalMs = 150 })
{
    let lastSample = 0;

    function update(now)
    {
        const start = performance.now();

        // The disabled path is the one that runs normally: no sink, no timing.
        if (debug && debug.enabled) {
            debug.beginStep();
            simulateOnce(scene, debug.timings);
        } else {
            simulateOnce(scene);
        }

        const afterSimulate = performance.now();

        // Called every frame, unconditionally: the view layer decides inside what
        // needs recomputing. The particle colour mode is a view option that works
        // with debug off, so gating this on the debug switch made that control do
        // nothing at all until debug was enabled.
        if (debug)
            debug.updateField(scene);

        drawFrame();
        const afterDraw = performance.now();

        if (debug && debug.enabled) {
            debug.recordStep({
                now,
                simulationTime: afterSimulate - start,
                renderTime: afterDraw - afterSimulate
            });

            if (onSample && now - lastSample >= sampleIntervalMs) {
                lastSample = now;
                debug.refreshCounts(scene);
                onSample(debug.stats);
            }
        }

        requestAnimationFrame(update);
    }

    // The original draws one frame synchronously on load rather than waiting for
    // the first animation frame, and that is kept.
    update(performance.now());
}

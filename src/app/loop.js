// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.

// One simulation step. Note that frameNr is incremented on every call, including
// when the scene is paused - that matches the original function, where the
// increment sat outside the `if (!scene.paused)` guard.
export function simulateOnce(scene)
{
    if (!scene.paused)
        scene.fluid.simulate(
            scene.dt, scene.gravity, scene.flipRatio, scene.numPressureIters, scene.numParticleIters,
            scene.overRelaxation, scene.compensateDrift, scene.separateParticles,
            scene.obstacleX, scene.obstacleY, scene.obstacleRadius,
            scene.obstacleVelX, scene.obstacleVelY);

    scene.frameNr++;
}

// The frame loop. It owns the two stages it can measure - simulation and render -
// and nothing else. Statistics are collected only while debug is enabled, and the
// panel behind them is refreshed at a fixed rate instead of every frame, because
// the simulation runs at 60 Hz and no one needs the DOM updated that often.
export function startLoop({ scene, renderer, debug, onSample, sampleIntervalMs = 150 })
{
    let lastSample = 0;

    function update(now)
    {
        const start = performance.now();
        simulateOnce(scene);
        const afterSimulate = performance.now();

        renderer.draw(scene);
        const afterDraw = performance.now();

        if (debug && debug.enabled) {
            debug.recordFrame(now, afterSimulate - start, afterDraw - afterSimulate);

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

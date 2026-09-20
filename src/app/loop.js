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

export function startLoop(scene, renderer)
{
    function update()
    {
        simulateOnce(scene);
        renderer.draw(scene);
        requestAnimationFrame(update);
    }

    update();
}

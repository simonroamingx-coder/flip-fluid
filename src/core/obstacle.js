// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.

// Moves the obstacle disc and stamps it into the solid cell field.
// `reset` skips the velocity estimate (used for teleports, e.g. the initial
// placement and the start of a drag).
export function setObstacle(scene, x, y, reset)
{
    let vx = 0.0;
    let vy = 0.0;

    if (!reset) {
        vx = (x - scene.obstacleX) / scene.dt;
        vy = (y - scene.obstacleY) / scene.dt;
    }

    scene.obstacleX = x;
    scene.obstacleY = y;
    const r = scene.obstacleRadius;
    const f = scene.fluid;
    const n = f.numY;

    for (let i = 1; i < f.numX - 2; i++) {
        for (let j = 1; j < f.numY - 2; j++) {

            f.s[i * n + j] = 1.0;

            const dx = (i + 0.5) * f.h - x;
            const dy = (j + 0.5) * f.h - y;

            if (dx * dx + dy * dy < r * r) {
                f.s[i * n + j] = 0.0;
                f.u[i * n + j] = vx;
                f.u[(i + 1) * n + j] = vx;
                f.v[i * n + j] = vy;
                f.v[i * n + j + 1] = vy;
            }
        }
    }

    scene.showObstacle = true;
    scene.obstacleVelX = vx;
    scene.obstacleVelY = vy;
}

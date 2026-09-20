// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.

import { setObstacle } from '../core/obstacle.js';

// Pointer, touch and keyboard handling. Behaviour matches the original:
// pressing the canvas drops the disc and unpauses, dragging moves it, and the
// arrow keys are not used. `p` toggles pause, `m` advances a single step.
export function attachInput({ canvas, doc, scene, cScale, stepOnce })
{
    let mouseDown = false;

    function startDrag(x, y)
    {
        const bounds = canvas.getBoundingClientRect();

        const mx = x - bounds.left - canvas.clientLeft;
        const my = y - bounds.top - canvas.clientTop;
        mouseDown = true;

        x = mx / cScale;
        y = (canvas.height - my) / cScale;

        setObstacle(scene, x, y, true);
        scene.paused = false;
    }

    function drag(x, y)
    {
        if (mouseDown) {
            const bounds = canvas.getBoundingClientRect();
            const mx = x - bounds.left - canvas.clientLeft;
            const my = y - bounds.top - canvas.clientTop;
            x = mx / cScale;
            y = (canvas.height - my) / cScale;
            setObstacle(scene, x, y, false);
        }
    }

    function endDrag()
    {
        mouseDown = false;
        scene.obstacleVelX = 0.0;
        scene.obstacleVelY = 0.0;
    }

    canvas.addEventListener('mousedown', event => {
        startDrag(event.clientX, event.clientY);
    });

    canvas.addEventListener('mouseup', event => {
        endDrag();
    });

    canvas.addEventListener('mousemove', event => {
        drag(event.clientX, event.clientY);
    });

    canvas.addEventListener('touchstart', event => {
        startDrag(event.touches[0].clientX, event.touches[0].clientY);
    });

    canvas.addEventListener('touchend', event => {
        endDrag();
    });

    canvas.addEventListener('touchmove', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        drag(event.touches[0].clientX, event.touches[0].clientY);
    }, { passive: false });

    doc.addEventListener('keydown', event => {
        switch (event.key) {
            case 'p': scene.paused = !scene.paused; break;
            case 'm': scene.paused = false; stepOnce(); scene.paused = true; break;
        }
    });
}

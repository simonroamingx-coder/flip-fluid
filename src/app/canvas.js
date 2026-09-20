// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.

export const SIM_HEIGHT = 3.0;

// The canvas is sized once at startup, exactly as in the original. A window
// resize does not re-measure it, which keeps the simulation domain identical
// to the reference build.
export function setupCanvas(canvas, viewport = window)
{
    canvas.width = viewport.innerWidth - 20;
    canvas.height = viewport.innerHeight - 20;

    canvas.focus();

    return computeDomain(canvas.width, canvas.height);
}

export function computeDomain(canvasWidth, canvasHeight, simHeight = SIM_HEIGHT)
{
    const cScale = canvasHeight / simHeight;
    const simWidth = canvasWidth / cScale;

    return { cScale, simHeight, simWidth };
}

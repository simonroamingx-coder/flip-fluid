// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.
//
// User-facing settings, kept apart from the live simulation state in scene.js:
// config is what a person chose, the scene is what the solver is doing.

export const PARTICLES = {
    min: 1000,
    max: 50000,
    step: 1000
};

export function createConfig()
{
    return {
        // null means "whatever the scenario works out from the tank", which is
        // exactly what v1.0.0 did. A number means the user asked for a count,
        // and the scenario solves for the grid resolution that produces it.
        particleCount: null
    };
}

export function clampParticleCount(value)
{
    return Math.max(PARTICLES.min, Math.min(PARTICLES.max, value));
}

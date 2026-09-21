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
        particleCount: null,

        debug: {
            // Collecting statistics while they are not being looked at would be
            // work for nothing.
            enabled: false,

            // What is drawn over the simulation. Particles and grid used to be
            // checkboxes on the top row; they moved here so that every view switch
            // is in one place, which is what the specification asks for. The three
            // below them need debug switched on, the two above it do not.
            showParticles: true,
            showGrid: false,
            showPressure: false,
            showCellTypes: false,
            showVelocity: false,

            // What the particles are coloured by. Density is the solver's own
            // scheme; the others are read out of the solver and drawn instead.
            particleColor: 'density'
        },

        // How the disc is drawn. Its radius is a simulation parameter rather than
        // an appearance one - the solver stamps the disc into the solid cells - so
        // changing it re-stamps, and changes how the fluid behaves.
        obstacle: {
            color: '#ff0000',
            opacity: 1,
            radius: 0.15
        }
    };
}

export function clampParticleCount(value)
{
    return Math.max(PARTICLES.min, Math.min(PARTICLES.max, value));
}

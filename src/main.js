// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.
//
// Entry point. The startup order matches the original file: context first, then
// canvas sizing, then scene construction, then the first frame.

import { createScene } from './core/scene.js';
import { setupScene } from './core/scenarios.js';
import { setObstacle } from './core/obstacle.js';
import { createConfig, clampParticleCount, PARTICLES } from './core/config.js';
import { Renderer } from './render/Renderer.js';
import { setupCanvas } from './app/canvas.js';
import { attachInput } from './app/Input.js';
import { attachControls, attachSettings } from './app/UI.js';
import { simulateOnce, startLoop } from './app/loop.js';
import { VERSION } from './version.js';

const canvas = document.getElementById('myCanvas');
const gl = canvas.getContext('webgl');

const { cScale, simWidth, simHeight } = setupCanvas(canvas);

const config = createConfig();
const scene = createScene();
setupScene(scene, simWidth, simHeight, config);

const renderer = new Renderer(gl, canvas, simWidth, simHeight);
renderer.init(scene.fluid);

attachInput({
    canvas,
    doc: document,
    scene,
    cScale,
    stepOnce: () => simulateOnce(scene)
});
attachControls(document, scene);

// Applying a particle count rebuilds the scene in place and re-initialises the
// renderer: its buffers are sized from the grid resolution and the particle
// count, so reusing them after a rebuild would draw with the old sizes.
function applyParticleCount(requested)
{
    config.particleCount = clampParticleCount(requested);
    setupScene(scene, simWidth, simHeight, config);
    renderer.init(scene.fluid);

    return {
        requested: scene.requestedParticles,
        actual: scene.fluid.numParticles,
        resolution: scene.gridResolution
    };
}

// The slider starts at whatever the scenario produced, rounded to its step.
attachSettings(document, {
    particleCount: clampParticleCount(Math.round(scene.fluid.numParticles / PARTICLES.step) * PARTICLES.step),
    onApply: applyParticleCount
});

// Shown in the corner of the page, so a screenshot or a running sim says which
// version it is without anyone having to ask git.
const versionElement = document.getElementById('version');
if (versionElement)
    versionElement.textContent = 'v' + VERSION;

startLoop(scene, renderer);

// Test hook used by test/parity-browser.mjs to drive this build and the
// original through identical states. It has no effect on normal behaviour.
window.__flip = {
    scene,
    renderer,
    config,
    step: () => simulateOnce(scene),
    draw: () => renderer.draw(scene),
    setObstacle: (x, y, reset) => setObstacle(scene, x, y, reset),
    applyParticleCount
};

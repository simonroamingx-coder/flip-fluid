// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.
//
// Entry point. The startup order matches the original file: context first, then
// canvas sizing, then scene construction, then the first frame.

import { createScene } from './core/scene.js';
import { setupScene } from './core/scenarios.js';
import { setObstacle } from './core/obstacle.js';
import { Renderer } from './render/Renderer.js';
import { setupCanvas } from './app/canvas.js';
import { attachInput } from './app/Input.js';
import { attachControls } from './app/UI.js';
import { simulateOnce, startLoop } from './app/loop.js';
import { VERSION } from './version.js';

const canvas = document.getElementById('myCanvas');
const gl = canvas.getContext('webgl');

const { cScale, simWidth, simHeight } = setupCanvas(canvas);

const scene = createScene();
setupScene(scene, simWidth, simHeight);

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
    step: () => simulateOnce(scene),
    draw: () => renderer.draw(scene),
    setObstacle: (x, y, reset) => setObstacle(scene, x, y, reset)
};

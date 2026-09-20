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

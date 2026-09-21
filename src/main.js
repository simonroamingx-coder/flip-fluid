// Copyright 2022 Matthias Müller - Ten Minute Physics (MIT). See ../../LICENSE.
//
// Entry point. The startup order matches the original file: context first, then
// canvas sizing, then scene construction, then the first frame.

import { createScene } from './core/scene.js';
import { setupScene } from './core/scenarios.js';
import { setObstacle } from './core/obstacle.js';
import { createConfig, clampParticleCount, PARTICLES } from './core/config.js';
import { createDebug } from './debug/Debug.js';
import { hexToRgb } from './utils/color.js';
import { Renderer } from './render/Renderer.js';
import { setupCanvas } from './app/canvas.js';
import { attachInput } from './app/Input.js';
import { attachControls, attachSettings, attachDisplayPanel } from './app/UI.js';
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

const debug = createDebug();
debug.setEnabled(config.debug.enabled);

// The view flags the renderer reads live in the scene, as they always have; the
// configuration holds the choice and the scene holds what is applied, the same
// way the particle count does.
scene.showParticles = config.debug.showParticles;
scene.showGrid = config.debug.showGrid;

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

    // Statistics from the previous scene would be misleading here, not just
    // stale - so they are cleared and the counts re-read from the new one.
    debug.reset();
    if (debug.enabled) {
        debug.refreshCounts(scene);
        debug.updateField(scene);
        debugPanel.update(debug.stats);
    }

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

const debugPanel = attachDisplayPanel(document, {
    enabled: config.debug.enabled,
    views: {
        particles: config.debug.showParticles,
        grid: config.debug.showGrid,
        pressure: config.debug.showPressure,
        cellTypes: config.debug.showCellTypes,
        velocity: config.debug.showVelocity
    },
    particleColor: config.debug.particleColor,
    obstacle: config.obstacle,
    onToggle: value => {
        config.debug.enabled = value;
        debug.setEnabled(value);
        debugPanel.setEnabled(value);

        if (value) {
            debug.refreshCounts(scene);
            debug.updateField(scene);
            debugPanel.update(debug.stats);
        } else {
            // A view with the collector switched off is neither collected nor
            // controllable, so switching debug off switches the debug views off
            // too - but particles and grid are not debug views and stay as they
            // are.
            config.debug.showPressure = false;
            config.debug.showCellTypes = false;
            config.debug.showVelocity = false;
            debug.setViews({ pressure: false, cellTypes: false, velocity: false });
            debugPanel.setViews({ pressure: false, cellTypes: false, velocity: false });
        }
    },
    onViews: views => {
        // Particles and grid are the two that used to be on the top row. They are
        // still scene state, which is what the renderer reads; the panel is simply
        // where they are set now.
        config.debug.showParticles = views.particles;
        config.debug.showGrid = views.grid;
        scene.showParticles = views.particles;
        scene.showGrid = views.grid;

        config.debug.showPressure = views.pressure;
        config.debug.showCellTypes = views.cellTypes;
        config.debug.showVelocity = views.velocity;
        debug.setViews(views);
        debug.updateField(scene);
    },
    onParticleColor: mode => {
        config.debug.particleColor = mode;
        debug.setParticleMode(mode);
        debug.updateField(scene);
    },
    onObstacle: appearance => {
        config.obstacle.color = appearance.color;
        config.obstacle.opacity = appearance.opacity;

        // The radius is a simulation parameter: the solver stamps the disc into the
        // solid cells, so a new size means re-stamping and a different flow.
        if (appearance.radius !== config.obstacle.radius) {
            config.obstacle.radius = appearance.radius;
            scene.obstacleRadius = appearance.radius;
            setObstacle(scene, scene.obstacleX, scene.obstacleY, true);
        }
    }
});

// One place that knows how a frame is drawn, used by the loop and by the test
// hook alike: a second copy in the hook would be free to drift from the loop,
// and a test that draws differently from the app tests the wrong thing.
function drawFrame()
{
    renderer.draw(scene, debug.fieldView(scene), {
        color: hexToRgb(config.obstacle.color),
        opacity: config.obstacle.opacity,
        radius: config.obstacle.radius
    });
}

// Shown in the corner of the page, so a screenshot or a running sim says which
// version it is without anyone having to ask git.
const versionElement = document.getElementById('version');
if (versionElement)
    versionElement.textContent = 'v' + VERSION;

startLoop({
    scene,
    drawFrame,
    debug,
    onSample: stats => debugPanel.update(stats)
});

// Test hook used by test/parity-browser.mjs to drive this build and the
// original through identical states. It has no effect on normal behaviour.
window.__flip = {
    scene,
    renderer,
    config,
    debug,
    step: () => simulateOnce(scene),
    draw: drawFrame,
    setObstacle: (x, y, reset) => setObstacle(scene, x, y, reset),
    applyParticleCount
};

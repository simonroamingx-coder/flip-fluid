// Shared plumbing for the headless checks.
//
// The simulation has no randomness and no wall-clock input, so a fixed sequence
// of steps from a fixed start state is fully deterministic. That is what makes
// comparing hashes meaningful: one changed float anywhere changes the hash.
//
// test/baseline.mjs uses this to check the build against recorded behaviour.
// test/parity.mjs uses it to check the build against the original demo.

import { createHash } from 'node:crypto';
import { createContext, Script } from 'node:vm';

import { computeDomain } from '../../src/app/canvas.js';
import { createScene } from '../../src/core/scene.js';
import { setupScene } from '../../src/core/scenarios.js';
import { setObstacle } from '../../src/core/obstacle.js';
import { simulateOnce } from '../../src/app/loop.js';

export const VIEWPORT = { innerWidth: 1280, innerHeight: 720 };

export const SCENARIO = '60 dam-break frames, 30 drag frames, 30 settle frames';

const ARRAYS = [
    'particlePos', 'particleVel', 'particleColor', 'particleDensity',
    'u', 'v', 'du', 'dv', 'prevU', 'prevV', 'p', 's',
    'cellType', 'cellColor',
    'numCellParticles', 'firstCellParticle', 'cellParticleIds'
];

const FLUID_SCALARS = [
    'numParticles', 'particleRestDensity', 'particleRadius', 'h', 'density',
    'fNumX', 'fNumY', 'fNumCells', 'pNumX', 'pNumY', 'pNumCells'
];

const SCENE_SCALARS = [
    'dt', 'gravity', 'flipRatio', 'numPressureIters', 'numParticleIters',
    'frameNr', 'overRelaxation', 'compensateDrift', 'separateParticles',
    'obstacleX', 'obstacleY', 'obstacleRadius', 'paused', 'showParticles', 'showGrid',
    'obstacleVelX', 'obstacleVelY', 'showObstacle'
];

function bytes(value)
{
    if (ArrayBuffer.isView(value))
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (typeof value === 'number') {
        const buffer = Buffer.alloc(8);
        buffer.writeDoubleLE(value, 0);
        return buffer;
    }
    return Buffer.from(String(value), 'utf8');
}

export function digest(value)
{
    return createHash('sha256').update(bytes(value)).digest('hex');
}

// Every array and scalar the simulation carries, as hex digests.
export function snapshot(fluid, scene)
{
    const out = {};

    for (const name of ARRAYS)
        out[name] = digest(fluid[name]);

    for (const name of FLUID_SCALARS)
        out['fluid.' + name] = digest(fluid[name]);

    for (const name of SCENE_SCALARS)
        out['scene.' + name] = digest(scene[name]);

    return out;
}

// ------------------------------------------------------------- the original

function createGlStub(canvas)
{
    return {
        canvas,
        VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632,
        COMPILE_STATUS: 35713, LINK_STATUS: 35714,
        ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963, DYNAMIC_DRAW: 35048,
        FLOAT: 5126, UNSIGNED_SHORT: 5123, POINTS: 0, TRIANGLES: 4,
        COLOR_BUFFER_BIT: 16384, DEPTH_BUFFER_BIT: 256,
        createShader: () => ({}),
        shaderSource() {}, compileShader() {},
        getShaderParameter: () => true,
        getShaderInfoLog: () => '',
        createProgram: () => ({}),
        attachShader() {}, linkProgram() {},
        getUniformLocation: () => ({}),
        getAttribLocation: () => 0,
        createBuffer: () => ({}),
        bindBuffer() {}, bufferData() {},
        useProgram() {},
        uniform1f() {}, uniform2f() {}, uniform3f() {},
        enableVertexAttribArray() {}, disableVertexAttribArray() {},
        vertexAttribPointer() {},
        drawArrays() {}, drawElements() {},
        clear() {}, clearColor() {}, viewport() {}
    };
}

// Boots the original single-file demo inside a VM with a DOM and WebGL stub,
// because its script needs a document and a GL context before it will run. Its
// core is not importable, which is the whole reason the refactor exists.
export function loadReference(refHtml)
{
    const scriptMatch = refHtml.match(/<script>([\s\S]*?)<\/script>/);
    if (!scriptMatch)
        throw new Error('no inline script found in the reference file');

    const listeners = { canvas: [], document: [] };
    const canvas = {
        width: 0, height: 0,
        clientLeft: 0, clientTop: 0,
        style: {},
        focus() {},
        addEventListener: (type, fn) => listeners.canvas.push({ type, fn }),
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 1260, bottom: 700 }),
        getContext: () => createGlStub(canvas)
    };

    const document = {
        getElementById: id => (id === 'myCanvas' ? canvas : null),
        addEventListener: (type, fn) => listeners.document.push({ type, fn })
    };

    const sandbox = {
        canvas, document, listeners,
        innerWidth: VIEWPORT.innerWidth,
        innerHeight: VIEWPORT.innerHeight,
        requestAnimationFrame: () => 0,
        console
    };
    sandbox.window = sandbox;

    const context = createContext(sandbox);
    new Script(scriptMatch[1], { filename: '18-flip.html <script>' }).runInContext(context);

    return {
        context,
        listeners,
        canvas,
        scene: context.scene,
        setObstacle: (x, y, reset) => context.setObstacle(x, y, reset),
        domain: { cScale: context.cScale, simWidth: context.simWidth, simHeight: context.simHeight }
    };
}

// ------------------------------------------------------------- the refactor

// Builds the current project the way its own page does: scene, dam break, and
// the single bootstrap frame that dev.html and index.html both run on load.
export function loadRefactored(simWidth, simHeight)
{
    const scene = createScene();
    setupScene(scene, simWidth, simHeight);
    simulateOnce(scene);

    return {
        scene,
        setObstacle: (x, y, reset) => setObstacle(scene, x, y, reset)
    };
}

export function domainForViewport()
{
    return computeDomain(VIEWPORT.innerWidth - 20, VIEWPORT.innerHeight - 20);
}

// ------------------------------------------------------------- the scenario

// Chosen to exercise every part of the solver: particle separation, obstacle
// collision, density, pressure, and the FLIP/PIC blend.
export function runScenario({ scene, setObstacle: place }, step)
{
    scene.paused = false;

    for (let i = 0; i < 60; i++)
        step();

    for (let i = 0; i < 30; i++) {
        place(1.5 + 0.06 * i, 1.2 + 0.02 * i, false);
        step();
    }

    for (let i = 0; i < 30; i++)
        step();
}

// The original reads the obstacle velocity from its global scene; the refactor
// takes it as a parameter. Same values at the same point in the step.
export function stepReference(scene)
{
    scene.fluid.simulate(
        scene.dt, scene.gravity, scene.flipRatio, scene.numPressureIters, scene.numParticleIters,
        scene.overRelaxation, scene.compensateDrift, scene.separateParticles,
        scene.obstacleX, scene.obstacleY, scene.obstacleRadius);
}

export function stepRefactored(scene, timings = null)
{
    scene.fluid.simulate(
        scene.dt, scene.gravity, scene.flipRatio, scene.numPressureIters, scene.numParticleIters,
        scene.overRelaxation, scene.compensateDrift, scene.separateParticles,
        scene.obstacleX, scene.obstacleY, scene.obstacleRadius,
        scene.obstacleVelX, scene.obstacleVelY, timings);
}

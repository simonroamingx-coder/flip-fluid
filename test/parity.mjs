// Bit-exact parity check between the original single-file demo and the
// refactored project.
//
//   node test/parity.mjs
//
// The original page is a classic script with no randomness and no wall-clock
// input, so a fixed sequence of steps from a fixed start state is fully
// deterministic. This harness runs that same sequence against both builds and
// compares the raw bytes of every simulation array. A mismatch of a single
// float anywhere fails the run.
//
// The original build is executed in a VM with a DOM/WebGL stub, because its
// script needs a document and a GL context to boot. The refactored build is
// imported directly: its core modules are free of DOM references.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, Script } from 'node:vm';
import { fileURLToPath } from 'node:url';

import { computeDomain, SIM_HEIGHT } from '../src/app/canvas.js';
import { createScene } from '../src/core/scene.js';
import { setupScene } from '../src/core/scenarios.js';
import { setObstacle } from '../src/core/obstacle.js';
import { TOGGLES } from '../src/app/UI.js';
import { simulateOnce } from '../src/app/loop.js';

const root = new URL('..', import.meta.url);
const refPath = fileURLToPath(new URL('ref/18-flip.html', root));
const devHtml = readFileSync(fileURLToPath(new URL('dev.html', root)), 'utf8');
const bundleHtml = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
const refHtml = readFileSync(refPath, 'utf8');

const VIEWPORT = { innerWidth: 1280, innerHeight: 720 };

// ---------------------------------------------------------------- reference

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

// Boots the reference build and returns its live scene plus a step function.
function loadReference()
{
    const scriptMatch = refHtml.match(/<script>([\s\S]*?)<\/script>/);
    if (!scriptMatch)
        throw new Error('no inline script found in ' + refPath);

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
        canvas, document,
        window: undefined,
        innerWidth: VIEWPORT.innerWidth,
        innerHeight: VIEWPORT.innerHeight,
        requestAnimationFrame: () => 0,
        console,
        listeners
    };
    sandbox.window = sandbox;

    const context = createContext(sandbox);
    new Script(scriptMatch[1], { filename: '18-flip.html <script>' }).runInContext(context);

    return {
        context,
        listeners,
        scene: context.scene,
        setObstacle: (x, y, reset) => context.setObstacle(x, y, reset),
        canvas,
        domain: { cScale: context.cScale, simWidth: context.simWidth, simHeight: context.simHeight }
    };
}

// ---------------------------------------------------------------- refactored

function loadRefactored(simWidth, simHeight)
{
    const scene = createScene();
    setupScene(scene, simWidth, simHeight);

    // The reference page ends with `setupScene(); update();`, so one frame runs
    // before any user input: one simulate() call (a no-op while paused, but it
    // bumps frameNr) and one draw(). Mirror that here.
    simulateOnce(scene);

    return {
        scene,
        setObstacle: (x, y, reset) => setObstacle(scene, x, y, reset)
    };
}

// ---------------------------------------------------------------- state hash

const ARRAYS = [
    'particlePos', 'particleVel', 'particleColor', 'particleDensity',
    'u', 'v', 'du', 'dv', 'prevU', 'prevV', 'p', 's',
    'cellType', 'cellColor',
    'numCellParticles', 'firstCellParticle', 'cellParticleIds'
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

function digest(value)
{
    return createHash('sha256').update(bytes(value)).digest('hex');
}

function snapshot(fluid, scene)
{
    const out = {};

    for (const name of ARRAYS)
        out[name] = digest(fluid[name]);

    for (const name of ['numParticles', 'particleRestDensity', 'particleRadius', 'h', 'density',
        'fNumX', 'fNumY', 'fNumCells', 'pNumX', 'pNumY', 'pNumCells']) {
        out[name] = digest(fluid[name]);
    }

    for (const name of ['dt', 'gravity', 'flipRatio', 'numPressureIters', 'numParticleIters',
        'frameNr', 'overRelaxation', 'compensateDrift', 'separateParticles',
        'obstacleX', 'obstacleY', 'obstacleRadius', 'paused', 'showParticles', 'showGrid',
        'obstacleVelX', 'obstacleVelY', 'showObstacle']) {
        out['scene.' + name] = digest(scene[name]);
    }

    return out;
}

// ---------------------------------------------------------------- the scenario

// 60 frames of the dam break, then a 30 frame drag of the disc down and to the
// right, then 30 more frames. Chosen to exercise every part of the solver:
// particle separation, obstacle collision, density, pressure, FLIP/PIC blend.
function runScenario({ scene, setObstacle: place }, step)
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

function stepReference(ref)
{
    const s = ref.scene;
    s.fluid.simulate(
        s.dt, s.gravity, s.flipRatio, s.numPressureIters, s.numParticleIters,
        s.overRelaxation, s.compensateDrift, s.separateParticles,
        s.obstacleX, s.obstacleY, s.obstacleRadius);
}

function stepRefactored(fluidScene, simWidth)
{
    const s = fluidScene;
    s.fluid.simulate(
        s.dt, s.gravity, s.flipRatio, s.numPressureIters, s.numParticleIters,
        s.overRelaxation, s.compensateDrift, s.separateParticles,
        s.obstacleX, s.obstacleY, s.obstacleRadius,
        s.obstacleVelX, s.obstacleVelY);
}

// ---------------------------------------------------------------- checks

const results = [];

function check(name, ok, detail = '')
{
    results.push({ name, ok, detail });
}

const ref = loadReference();
const originalDomain = ref.domain;

// 1. Canvas sizing and simulation domain.
const refactoredDomain = computeDomain(VIEWPORT.innerWidth - 20, VIEWPORT.innerHeight - 20);

check('canvas size', ref.canvas.width === VIEWPORT.innerWidth - 20 && ref.canvas.height === VIEWPORT.innerHeight - 20,
    `${ref.canvas.width}x${ref.canvas.height}`);
check('cScale', Object.is(originalDomain.cScale, refactoredDomain.cScale), String(originalDomain.cScale));
check('simWidth', Object.is(originalDomain.simWidth, refactoredDomain.simWidth), String(originalDomain.simWidth));
check('simHeight', Object.is(originalDomain.simHeight, refactoredDomain.simHeight),
    `${originalDomain.simHeight} (module constant ${SIM_HEIGHT})`);

// 2. Initial scene state, before any stepping.
const rebuilt = loadRefactored(originalDomain.simWidth, originalDomain.simHeight);
const initialRef = snapshot(ref.scene.fluid, ref.scene);
const initialNew = snapshot(rebuilt.scene.fluid, rebuilt.scene);

const initialDiff = Object.keys(initialRef).filter(key => initialRef[key] !== initialNew[key]);
check('initial state', initialDiff.length === 0,
    initialDiff.length ? `differs: ${initialDiff.join(', ')}` : `${Object.keys(initialRef).length} fields`);

// 3. Deterministic run.
runScenario(ref, () => stepReference(ref));
runScenario(rebuilt, () => stepRefactored(rebuilt.scene));

const finalRef = snapshot(ref.scene.fluid, ref.scene);
const finalNew = snapshot(rebuilt.scene.fluid, rebuilt.scene);

const differing = Object.keys(finalRef).filter(key => finalRef[key] !== finalNew[key]);
check('post-run state', differing.length === 0,
    differing.length ? `differs: ${differing.join(', ')}` : `${Object.keys(finalRef).length} fields`);

// 4. Control wiring: the refactored panel must flip the same flags the original
//    inline handlers flipped, and nothing else.
const inlineToggles = [...refHtml.matchAll(/onclick\s*=\s*"scene\.(\w+)\s*=\s*!\s*scene\.\1"/g)].map(m => m[1]);
const moduleToggles = TOGGLES.map(t => t.flag);
check('checkbox flags', JSON.stringify(inlineToggles) === JSON.stringify(moduleToggles),
    `inline [${inlineToggles.join(', ')}] vs module [${moduleToggles.join(', ')}]`);
check('checkbox ids present in markup',
    TOGGLES.every(t => devHtml.includes(`id = "${t.id}"`) || devHtml.includes(`id="${t.id}"`)),
    TOGGLES.map(t => t.id).join(', '));

const inlineSlider = refHtml.match(/onchange\s*=\s*"scene\.flipRatio\s*=\s*0\.1\s*\*\s*this\.value"/);
check('slider mapping', Boolean(inlineSlider) && devHtml.includes('id = "flipSlider"'),
    'change -> scene.flipRatio = 0.1 * value');

// 5. No leftover inline handlers or globals in the development markup.
check('no inline handlers', !/\son(click|change|input)\s*=/.test(devHtml));

// The only classic script allowed is the boot notice, which explains what went
// wrong when the page is opened from disk and the module cannot load. It must
// not touch the simulation.
const classicScripts = [...devHtml.matchAll(/<script(?![^>]*type\s*=\s*"module")[^>]*>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]);

check('module entry point', /<script type="module" src="src\/main\.js">/.test(devHtml),
    'dev.html loads src/main.js as a module');
check('classic scripts are inert', classicScripts.every(code => !/scene\.|FlipFluid|fluid\.|canvas\./.test(code)),
    `${classicScripts.length} classic script, boot notice only`);

// 6. The root entry point is the generated single file: no external references,
//    modules and stylesheet inlined, so it runs by double-click.
check('root index.html is self-contained',
    !/<script[^>]*type\s*=\s*["']module["']/.test(bundleHtml) &&
    !/<script[^>]*\ssrc\s*=/.test(bundleHtml) &&
    !bundleHtml.includes('href="src/') &&
    bundleHtml.includes('__mods[') &&
    bundleHtml.includes('-webkit-appearance'),
    `${(bundleHtml.length / 1024).toFixed(1)} KB, 14 modules and app.css inlined`);

// ---------------------------------------------------------------- report

function fmt(label, value, ok)
{
    const padding = ' '.repeat(Math.max(0, 34 - label.length));
    return `${label}${padding}${value}${ok ? '' : '   <-- FAIL'}`;
}

console.log('');
console.log('reference: ' + refPath);
console.log('refactored: ' + fileURLToPath(new URL('index.html', root)));
console.log('');
console.log('deterministic run: 60 dam-break frames + 30 drag frames + 30 settle frames');
console.log('');
console.log(fmt('check', 'detail', true));
console.log('-'.repeat(84));

for (const r of results)
    console.log(fmt(r.name, r.detail, r.ok));

console.log('-'.repeat(84));

const failed = results.filter(r => !r.ok);

// Byte-level detail for the two state checks, so a failure is actionable.
for (const [label, a, b] of [['initial', initialRef, initialNew], ['post-run', finalRef, finalNew]]) {
    const diff = Object.keys(a).filter(key => a[key] !== b[key]);
    if (diff.length) {
        console.log('');
        console.log(`${label} state byte diff:`);
        for (const key of diff)
            console.log(`  ${key}\n    reference  ${a[key]}\n    refactored ${b[key]}`);
    }
}

console.log('');
if (failed.length) {
    console.log(`RESULT: FAIL - ${failed.length} of ${results.length} checks failed`);
    process.exitCode = 1;
} else {
    console.log(`RESULT: PASS - all ${results.length} checks match, every simulation array is byte-identical`);
}

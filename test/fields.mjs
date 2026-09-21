// Do the debug views show the solver's own data, in the right places, and only
// read it?
//
//   node test/fields.mjs
//
// The views write a colour per cell into a buffer that is uploaded as a texture.
// Three things have to hold: the picture is derived from what the solver holds,
// it is laid out the way the texture expects, and drawing it cannot change the
// simulation. The last one is checked the same way as the profiler is - take a
// full snapshot of the state, write every view, compare.

import { AIR_CELL, FLUID_CELL, SOLID_CELL } from '../src/core/constants.js';
import {
    FLOATS_PER_VECTOR, PARTICLE_MODES, VELOCITY, VERTICES_PER_VECTOR,
    createParticleRange, createPressureRange, writeCellTypes, writeParticleColors,
    writePressureColors, writeVelocityVectors
} from '../src/debug/fields.js';
import { domainForViewport, loadRefactored, snapshot, stepRefactored } from './lib/harness.mjs';
import { Renderer } from '../src/render/Renderer.js';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const domain = domainForViewport();
const build = loadRefactored(domain.simWidth, domain.simHeight);

// Step it, so there is pressure and a cell classification to look at.
for (let step = 0; step < 10; step++)
    stepRefactored(build.scene);

const fluid = build.scene.fluid;
fluid.classifyCells();

const colors = new Uint8Array(3 * fluid.fNumCells);
const range = createPressureRange();

// Colours are written in texture order: one texel per cell, row by row, with y
// varying slowest. The solver indexes its cells the other way round, so both
// mappings are spelled out here once.
const texel = (xi, yi) => 3 * (yi * fluid.fNumX + xi);
const cellAt = (xi, yi) => xi * fluid.fNumY + yi;

// ------------------------------------------------- views must not write back

const before = snapshot(fluid, build.scene);
writePressureColors(fluid, colors, range);
writeCellTypes(fluid, colors);
const particleColors = new Float32Array(3 * fluid.maxParticles);
const particleScratch = new Float32Array(fluid.maxParticles);
const particleRange = createParticleRange();
writeParticleColors(fluid, particleColors, 'speed', particleRange, particleScratch);
writeParticleColors(fluid, particleColors, 'pressure', particleRange, particleScratch);
writeParticleColors(fluid, particleColors, 'vorticity', particleRange, particleScratch);
const after = snapshot(fluid, build.scene);

const changed = Object.keys(before).filter(key => before[key] !== after[key]);
check('views only read the solver', changed.length === 0,
    changed.length ? `changed: ${changed.join(', ')}` : `${Object.keys(before).length} fields untouched`);

// ------------------------------------------------------------ the pressure view

// The colour scale is smoothed, so let it settle the way it would over a second
// of frames before judging the result.
for (let frame = 0; frame < 30; frame++)
    writePressureColors(fluid, colors, range);

let fluidCells = 0;
let coloured = 0;
let wrong = 0;
let brightest = 0;

for (let yi = 0; yi < fluid.fNumY; yi++) {
    for (let xi = 0; xi < fluid.fNumX; xi++) {
        const offset = texel(xi, yi);
        const cell = cellAt(xi, yi);
        const red = colors[offset];
        const green = colors[offset + 1];
        const blue = colors[offset + 2];

        if (red > 255 || green > 255 || blue > 255) {
            wrong++;
            continue;
        }

        if (fluid.cellType[cell] !== FLUID_CELL) {
            if (red || green || blue) wrong++;      // air and solid are not fluid
            continue;
        }

        fluidCells++;
        if (red || blue) coloured++;
        if (red > brightest) brightest = red;

        // Intensity in red, and only red: it tracks the size of the pressure,
        // whichever direction it is acting in. Nothing else is allowed to carry
        // colour, which is what the green and blue checks are for.
        if (green || blue) wrong++;
        const expected = Math.min(255, Math.round(255 * Math.abs(fluid.p[cell]) / range.peak));
        if (Math.abs(red - expected) > 1) wrong++;
    }
}

check('pressure view is red intensity, and only red', wrong === 0,
    wrong ? `${wrong} cells drawn wrong`
        : `${fluidCells} fluid cells, brightest ${brightest} of 255`);

check('pressure view is not blank', coloured > fluidCells * 0.2,
    `${coloured} of ${fluidCells} fluid cells carry a colour`);

check('pressure scale settles', range.peak > 0,
    `peak ${range.peak.toFixed(1)}`);

// ------------------------------------------------------- the cell type view

writeCellTypes(fluid, colors);

const SOLID = [158, 158, 158];
const FLUID = [38, 89, 255];
const AIR = [10, 13, 26];

const isColour = (offset, colour) => colors[offset] === colour[0]
    && colors[offset + 1] === colour[1]
    && colors[offset + 2] === colour[2];

const drawn = { solid: 0, fluid: 0, air: 0, other: 0 };

for (let yi = 0; yi < fluid.fNumY; yi++) {
    for (let xi = 0; xi < fluid.fNumX; xi++) {
        const offset = texel(xi, yi);
        if (isColour(offset, SOLID)) drawn.solid++;
        else if (isColour(offset, FLUID)) drawn.fluid++;
        else if (isColour(offset, AIR)) drawn.air++;
        else drawn.other++;
    }
}

const inGrid = { solid: 0, fluid: 0, air: 0 };

for (let i = 0; i < fluid.fNumCells; i++) {
    if (fluid.cellType[i] === SOLID_CELL) inGrid.solid++;
    else if (fluid.cellType[i] === FLUID_CELL) inGrid.fluid++;
    else inGrid.air++;
}

check('cell view draws every cell as its own type',
    drawn.other === 0
    && drawn.solid === inGrid.solid && drawn.fluid === inGrid.fluid && drawn.air === inGrid.air,
    `drawn ${drawn.solid} solid, ${drawn.fluid} fluid, ${drawn.air} air`
    + ` | grid ${inGrid.solid}, ${inGrid.fluid}, ${inGrid.air}`
    + (drawn.other ? ` | ${drawn.other} unrecognised` : ''));

// Orientation, checked without reusing the mapping above: setupScene makes the
// tank floor solid (row j = 0), so the first row of the texture has to be solid.
// If the writing order were transposed, that row would be a column instead and
// this would read as mostly fluid.
let floorSolid = 0;
for (let xi = 0; xi < fluid.fNumX; xi++) {
    if (isColour(3 * xi, SOLID))
        floorSolid++;
}

check('the field is the right way up', floorSolid === fluid.fNumX,
    `the first texture row is ${floorSolid} of ${fluid.fNumX} solid cells - the tank floor`);

// ------------------------------------------------------------- velocity vectors

const vertices = new Float32Array(4 * fluid.fNumCells);
const vectors = writeVelocityVectors(fluid, vertices);

let expected = 0;
let misplaced = 0;
let wrongLength = 0;
let overCap = 0;
let capped = 0;
let moved = 0;

for (let xi = 1; xi < fluid.fNumX - 1; xi += VELOCITY.stride) {
    for (let yi = 1; yi < fluid.fNumY - 1; yi += VELOCITY.stride) {
        if (fluid.cellType[cellAt(xi, yi)] === FLUID_CELL)
            expected++;
    }
}

check('vectors are sampled, not one per cell', vectors === expected && vectors > 0 && vectors < fluid.fNumCells / 4,
    `${vectors} vectors from ${fluid.fNumCells} cells, stride ${VELOCITY.stride}`);

for (let index = 0; index < vectors; index++) {
    const offset = 4 * index;
    const x1 = vertices[offset];
    const y1 = vertices[offset + 1];
    const x2 = vertices[offset + 2];
    const y2 = vertices[offset + 3];

    // Starts at the centre of a fluid cell: the arrow belongs to a cell the solver
    // actually has a velocity for.
    const xi = Math.round(x1 / fluid.h - 0.5);
    const yi = Math.round(y1 / fluid.h - 0.5);
    if (fluid.cellType[cellAt(xi, yi)] !== FLUID_CELL)
        misplaced++;

    // Length is the cell's velocity times the display scale, capped so the
    // fastest cells cannot draw lines across the picture. The cell's velocity is
    // the mean of the two faces bounding it in each direction.
    const cell = cellAt(xi, yi);
    const ux = 0.5 * (fluid.u[cell] + fluid.u[(xi + 1) * fluid.fNumY + yi]);
    const vy = 0.5 * (fluid.v[cell] + fluid.v[cell + 1]);
    const speed = Math.hypot(ux, vy);
    const wanted = speed * VELOCITY.scale;
    const expectedLength = Math.min(wanted, VELOCITY.cap);
    const length = Math.hypot(x2 - x1, y2 - y1);

    if (Math.abs(length - expectedLength) > 1e-4)
        wrongLength++;
    if (length > VELOCITY.cap + 1e-4)
        overCap++;
    if (wanted > VELOCITY.cap)
        capped++;
    if (length > 1e-6)
        moved++;
}

check('vectors belong to fluid cells', misplaced === 0,
    `${vectors} vectors, ${expected} fluid cells sampled, ${misplaced} misplaced`);

check('vector length is speed times the scale, capped', wrongLength === 0,
    wrongLength ? `${wrongLength} vectors with the wrong length`
        : `scale ${VELOCITY.scale}, cap ${VELOCITY.cap}, ${capped} of ${vectors} capped`);

check('no vector is longer than the cap', overCap === 0,
    `longest allowed ${VELOCITY.cap}, longest drawn ${Math.max(...Array.from({ length: vectors },
        (_, index) => Math.hypot(vertices[4 * index + 2] - vertices[4 * index],
            vertices[4 * index + 3] - vertices[4 * index + 1]))).toFixed(3)}`);

check('the vectors show motion', moved > vectors * 0.2,
    `${moved} of ${vectors} vectors have a length`);

// ------------------------------------------------ the renderer's half of it
//
// Writer and renderer have to agree on the layout: one segment per vector, two
// vertices, four floats. When they derived it separately the renderer drew half
// the vectors - exactly the left half of the tank, in scan order - so this drives
// the draw call with a stand-in context and checks what it asked for.

const calls = { upload: null, draw: null };

const fakeGl = {
    ARRAY_BUFFER: 1, FLOAT: 2, LINES: 3, DYNAMIC_DRAW: 4,
    useProgram() {}, uniform2f() {}, uniform3f() {},
    bindBuffer() {}, enableVertexAttribArray() {}, vertexAttribPointer() {},
    disableVertexAttribArray() {},
    bufferData(target, data) { calls.upload = data; },
    drawArrays(mode, first, count) { calls.draw = { mode, first, count }; }
};

const renderer = new Renderer(fakeGl, { width: 100, height: 100 }, 5, 3);
renderer.lineShader = {};
renderer.lineLocations = { uniforms: { domainSize: {}, color: {} }, attributes: { attrPosition: 0 } };
renderer.lineBuffer = {};

renderer.drawLines(new Float32Array(4 * 3), 3);

check('the renderer draws one segment per vector',
    Boolean(calls.draw) && calls.draw.mode === fakeGl.LINES && calls.draw.first === 0
    && calls.draw.count === 3 * VERTICES_PER_VECTOR,
    `asked for ${calls.draw ? calls.draw.count : '?'} vertices for 3 vectors`);

check('the renderer uploads the whole buffer',
    Boolean(calls.upload) && calls.upload.length === 3 * FLOATS_PER_VECTOR,
    `uploaded ${calls.upload ? calls.upload.length : '?'} floats for 3 vectors`);

// ------------------------------------------------------- particle colour modes

const modes = PARTICLE_MODES.filter(mode => mode !== 'density');
const colourings = new Map();
const problems = [];

for (const mode of modes) {
    const range = createParticleRange();
    const written = new Float32Array(3 * fluid.maxParticles);

    // Let the smoothed scale settle the way it would over a second of frames.
    for (let frame = 0; frame < 40; frame++)
        writeParticleColors(fluid, written, mode, range, particleScratch);

    let lowest = Infinity;
    let highest = -Infinity;
    let lowestColor = null;
    let highestColor = null;

    for (let i = 0; i < fluid.numParticles; i++) {
        const red = written[3 * i];
        const green = written[3 * i + 1];
        const blue = written[3 * i + 2];

        // 0..1, the range the shader reads: writing 0..255 here is what made every
        // particle white and every mode look identical.
        if (red > 1 || green > 1 || blue > 1 || red < 0 || green < 0 || blue < 0)
            problems.push(`${mode}: a colour out of range`);

        const value = mode === 'speed'
            ? Math.hypot(fluid.particleVel[2 * i], fluid.particleVel[2 * i + 1])
            : null;

        if (value !== null) {
            if (value < lowest) { lowest = value; lowestColor = [red, green, blue]; }
            if (value > highest) { highest = value; highestColor = [red, green, blue]; }
        }
    }

    colourings.set(mode, written);

    // The extremes of the quantity have to land at the ends of the ramp: blue at
    // the bottom, red at the top. That is what "coloured by" has to mean.
    if (mode === 'speed') {
        if (!(lowestColor[2] > lowestColor[0]))
            problems.push(`${mode}: the slowest particle is not at the blue end`);
        if (!(highestColor[0] > highestColor[2]))
            problems.push(`${mode}: the fastest particle is not at the red end`);
    }
}

check('every colour mode writes a colour per particle', problems.length === 0,
    problems.length ? problems.join('; ')
        : `${modes.join(', ')} - all ${fluid.numParticles} particles, all within the ramp`);

const distinct = new Set(modes.map(mode => {
    const written = colourings.get(mode);
    let sum = 0;
    for (let i = 0; i < written.length; i += 7)
        sum = (sum * 31 + written[i]) % 1e9;
    return sum;
}));

check('the modes colour differently', distinct.size === modes.length,
    `${modes.length} modes, ${distinct.size} distinct colourings`);

// ---------------------------------------------------------- the disc appearance

const discCalls = { color: null, alpha: null, blending: false, blendingAtDraw: null };
const discGl = {
    ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2, FLOAT: 3, UNSIGNED_SHORT: 4,
    TRIANGLES: 5, DEPTH_BUFFER_BIT: 6, BLEND: 7, SRC_ALPHA: 8, ONE_MINUS_SRC_ALPHA: 9,
    clear() {}, useProgram() {}, uniform2f() {}, bindBuffer() {},
    vertexAttribPointer() {}, enableVertexAttribArray() {}, disableVertexAttribArray() {},
    drawElements() { discCalls.blendingAtDraw = discCalls.blending; },
    uniform3f(location, r, g, b) { if (location === 'color') discCalls.color = [r, g, b]; },
    uniform1f(location, value) { if (location === 'alpha') discCalls.alpha = value; },
    enable(cap) { discCalls.blending = cap === 7; },
    disable(cap) { if (cap === 7) discCalls.blending = false; },
    blendFunc() {}
};

const discRenderer = new Renderer(discGl, { width: 100, height: 100 }, 5, 3);
discRenderer.meshShader = {};
discRenderer.meshLocations = {
    // Named sentinels, because the recorder has to tell one uniform from another:
    // the disc's size is also a single float, and it was being read as the opacity.
    uniforms: { domainSize: 'domainSize', color: 'color', translation: 'translation', scale: 'scale', alpha: 'alpha' },
    attributes: { attrPosition: 0 }
};
discRenderer.diskVertBuffer = {};
discRenderer.diskIdBuffer = {};

discRenderer.drawObstacle(build.scene, fluid, { color: [0, 0.25, 1], opacity: 1 });
const opaque = { ...discCalls };
discRenderer.drawObstacle(build.scene, fluid, { color: [0, 0.25, 1], opacity: 0.4 });
const faint = { ...discCalls };

check('the disc takes the colour and opacity it is given',
    opaque.color[2] === 1 && opaque.color[0] === 0 && opaque.alpha === 1
    && faint.alpha === 0.4,
    `opaque ${JSON.stringify(opaque.color)} at alpha ${opaque.alpha}, faint at alpha ${faint.alpha}`);

check('blending only when the disc is transparent',
    !opaque.blendingAtDraw && faint.blendingAtDraw === true,
    'an opaque disc draws exactly as it always did');

// ------------------------------------------------------------------- report

function fmt(label, value, ok)
{
    const padding = ' '.repeat(Math.max(0, 36 - label.length));
    return `${label}${padding}${value}${ok ? '' : '   <-- FAIL'}`;
}

console.log('');
console.log('debug views over the solver data, ' + fluid.fNumX + 'x' + fluid.fNumY + ' cells');
console.log('');
console.log(fmt('check', 'detail', true));
console.log('-'.repeat(100));

for (const result of results)
    console.log(fmt(result.name, result.detail, result.ok));

console.log('-'.repeat(100));

const failed = results.filter(result => !result.ok);

console.log('');
if (failed.length) {
    console.log(`RESULT: FAIL - ${failed.length} of ${results.length} checks failed`);
    process.exitCode = 1;
} else {
    console.log(`RESULT: PASS - all ${results.length} checks match`);
}

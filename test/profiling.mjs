// Does the profiler change what it measures?
//
//   node test/profiling.mjs
//
// The stage timings come from performance.now() calls wrapped around the
// solver's own stages. The bar for that change is that it has to be invisible:
// the same steps with a timing sink and without one must produce byte-identical
// state. That is the first check here, and it is the one that matters. The other
// two check that the numbers are actually being reported and that they add up to
// something the size of the step they came from.

import { createTimings } from '../src/debug/Debug.js';
import { domainForViewport, loadRefactored, snapshot, stepRefactored } from './lib/harness.mjs';

const domain = domainForViewport();

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const STEPS = 40;

// --------------------------------------------------- timing must not perturb

const timed = loadRefactored(domain.simWidth, domain.simHeight);
const plain = loadRefactored(domain.simWidth, domain.simHeight);

const timings = createTimings();
const totals = createTimings();
let measured = 0;

for (let step = 0; step < STEPS; step++) {
    // cleared the way the frame loop clears it, so each step is measured alone
    for (const key in timings)
        timings[key] = 0;

    const before = performance.now();
    stepRefactored(timed.scene, timings);
    const elapsed = performance.now() - before;

    measured += elapsed;
    for (const key in timings)
        totals[key] += timings[key];
}

for (let step = 0; step < STEPS; step++)
    stepRefactored(plain.scene);

const timedState = snapshot(timed.scene.fluid, timed.scene);
const plainState = snapshot(plain.scene.fluid, plain.scene);
const differing = Object.keys(timedState).filter(key => timedState[key] !== plainState[key]);

check('timing does not change the result',
    differing.length === 0,
    differing.length
        ? `differs after ${STEPS} steps: ${differing.join(', ')}`
        : `${Object.keys(timedState).length} fields identical after ${STEPS} steps`);

// ------------------------------------------------------- the numbers reported

const stages = Object.keys(totals);
const invalid = stages.filter(key => !Number.isFinite(totals[key]) || totals[key] < 0);
const sum = stages.reduce((total, key) => total + totals[key], 0);

check('every stage is reported',
    invalid.length === 0 && sum > 0,
    invalid.length ? `not a number: ${invalid.join(', ')}` : `${stages.length} stages, ${sum.toFixed(1)} ms across ${STEPS} steps`);

check('pressure is a real cost',
    totals.pressureTime > 0,
    `pressure ${totals.pressureTime.toFixed(1)} ms, particles ${totals.particleTime.toFixed(1)} ms, `
    + `to grid ${totals.particleToGridTime.toFixed(1)} ms, to particles ${totals.gridToParticleTime.toFixed(1)} ms`);

// The stages are measured inside the step, so they cannot add up to more than
// it did. A little slack for the clock itself.
check('stages fit inside the step',
    sum <= measured * 1.02,
    `${sum.toFixed(1)} ms of stages inside ${measured.toFixed(1)} ms of stepping`);

// ------------------------------------------------------------------- report

function fmt(label, value, ok)
{
    const padding = ' '.repeat(Math.max(0, 34 - label.length));
    return `${label}${padding}${value}${ok ? '' : '   <-- FAIL'}`;
}

console.log('');
console.log('stage profiling, ' + STEPS + ' steps at the default scene');
console.log('');
console.log(fmt('check', 'detail', true));
console.log('-'.repeat(96));

for (const result of results)
    console.log(fmt(result.name, result.detail, result.ok));

console.log('-'.repeat(96));

console.log('');
console.log('  per step, averaged');
for (const key of stages)
    console.log('    ' + key.padEnd(24) + (totals[key] / STEPS).toFixed(3) + ' ms');

const failed = results.filter(result => !result.ok);

console.log('');
if (failed.length) {
    console.log(`RESULT: FAIL - ${failed.length} of ${results.length} checks failed`);
    process.exitCode = 1;
} else {
    console.log(`RESULT: PASS - all ${results.length} checks match`);
}

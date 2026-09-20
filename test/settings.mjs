// Does asking for a particle count actually produce one?
//
//   node test/settings.mjs
//
// Particle count is not a free parameter in this scenario: it falls out of the
// grid resolution. Asking for a count therefore means solving for the resolution
// that comes closest, and because the lattice is hexagonal only particular
// counts exist. This checks that solve across the slider's whole range, without
// a browser.

import { PARTICLES } from '../src/core/config.js';
import { DEFAULT_RESOLUTION, particleCountAt, resolutionForParticleCount } from '../src/core/scenarios.js';
import { domainForViewport } from './lib/harness.mjs';

const { simWidth, simHeight } = domainForViewport();

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

// The default must not move. This is the number v1.0.0 produced, and the
// behaviour baseline is the deeper proof that nothing downstream of it changed.
const atDefault = particleCountAt(DEFAULT_RESOLUTION, simWidth, simHeight);
check('default count unchanged', atDefault === 25900,
    `${atDefault} particles at grid ${DEFAULT_RESOLUTION}`);

// Walk the slider's range and measure how far off the requested count lands.
let worst = { target: 0, error: 0, got: 0, resolution: 0 };
let previous = 0;
let monotonic = true;

for (let target = PARTICLES.min; target <= PARTICLES.max; target += PARTICLES.step) {
    const resolution = resolutionForParticleCount(target, simWidth, simHeight);
    const got = particleCountAt(resolution, simWidth, simHeight);
    const error = Math.abs(got - target) / target;

    if (error > worst.error)
        worst = { target, error, got, resolution };
    if (got < previous)
        monotonic = false;
    previous = got;
}

check('every step lands close', worst.error < 0.05,
    `worst: asked ${worst.target}, got ${worst.got} (${(worst.error * 100).toFixed(1)}% off, grid ${worst.resolution})`);
check('asking for more never gives fewer', monotonic, 'the count rises with the request');

function fmt(label, value, ok)
{
    const padding = ' '.repeat(Math.max(0, 34 - label.length));
    return `${label}${padding}${value}${ok ? '' : '   <-- FAIL'}`;
}

console.log('');
console.log('settings solver, ' + PARTICLES.min + '-' + PARTICLES.max + ' in steps of ' + PARTICLES.step);
console.log('');
console.log(fmt('check', 'detail', true));
console.log('-'.repeat(88));

for (const result of results)
    console.log(fmt(result.name, result.detail, result.ok));

console.log('-'.repeat(88));

const failed = results.filter(result => !result.ok);

console.log('');
if (failed.length) {
    console.log(`RESULT: FAIL - ${failed.length} of ${results.length} checks failed`);
    process.exitCode = 1;
} else {
    console.log(`RESULT: PASS - all ${results.length} checks match`);
}

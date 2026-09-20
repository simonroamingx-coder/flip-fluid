// Does the simulation still behave the way it did when you last recorded it?
//
//   node test/baseline.mjs            check against test/baseline.json
//   node test/baseline.mjs --update   re-record it
//
// This is the day-to-day regression net. Unlike test/parity.mjs, which compares
// against the original demo and can only pass while behaviour is unchanged,
// this compares against a snapshot you own. A failure means "behaviour moved
// and you did not say so" - so when you change something on purpose, re-record,
// look at the diff, and commit it.
//
// The digests are hashes of the simulation arrays after a fixed deterministic
// run. The arithmetic involved (sqrt, floor, min/max, IEEE-754 floats) is
// specified exactly, so the same hashes appear on any machine; one changed
// float anywhere changes a hash.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    VIEWPORT, SCENARIO, domainForViewport, loadRefactored, runScenario, snapshot, stepRefactored
} from './lib/harness.mjs';

const baselinePath = fileURLToPath(new URL('baseline.json', import.meta.url));
const update = process.argv.includes('--update');

const domain = domainForViewport();
const build = loadRefactored(domain.simWidth, domain.simHeight);

runScenario(build, () => stepRefactored(build.scene));

const state = snapshot(build.scene.fluid, build.scene);
const record = {
    note: 'Behaviour snapshot. Regenerate with `node test/baseline.mjs --update` when a change is intended.',
    scenario: SCENARIO,
    viewport: `${VIEWPORT.innerWidth}x${VIEWPORT.innerHeight}`,
    canvas: `${VIEWPORT.innerWidth - 20}x${VIEWPORT.innerHeight - 20}`,
    particles: build.scene.fluid.numParticles,
    fields: state
};

console.log('');
console.log('behaviour baseline');
console.log('  scenario   ' + SCENARIO);
console.log('  canvas     ' + record.canvas + '  particles ' + record.particles);
console.log('  fields     ' + Object.keys(state).length);

if (update) {
    writeFileSync(baselinePath, JSON.stringify(record, null, 2) + '\n');
    console.log('');
    console.log('recorded: ' + baselinePath);
    console.log('');
    console.log('RESULT: RECORDED - commit test/baseline.json so the new behaviour is the agreed one');
    process.exit(0);
}

if (!existsSync(baselinePath)) {
    console.log('');
    console.log('RESULT: FAIL - no baseline recorded yet; run `node test/baseline.mjs --update`');
    process.exit(1);
}

const previous = JSON.parse(readFileSync(baselinePath, 'utf8'));
const names = [...new Set([...Object.keys(previous.fields), ...Object.keys(state)])].sort();
const changed = names.filter(name => previous.fields[name] !== state[name]);

console.log('');

if (changed.length) {
    console.log('  field                              recorded         now');
    console.log('  ' + '-'.repeat(70));
    for (const name of changed)
        console.log('  ' + name.padEnd(33) + String(previous.fields[name] ?? '-').slice(0, 16).padEnd(17)
            + String(state[name] ?? '-').slice(0, 16));
    if (previous.particles !== record.particles)
        console.log('\n  particle count changed: ' + previous.particles + ' -> ' + record.particles);
    console.log('');
    console.log(`RESULT: FAIL - ${changed.length} of ${names.length} fields changed since the baseline`);
    console.log('');
    console.log('If that was the point of your change, re-record it and commit the new baseline:');
    console.log('  node test/baseline.mjs --update');
    console.log('If it was not, you have a regression: `git diff` against the last commit.');
    process.exit(1);
}

console.log('');
console.log(`RESULT: PASS - all ${names.length} fields match the recorded baseline`);

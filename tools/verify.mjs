// Run this before you commit.
//
//   node tools/verify.mjs            rebuild index.html + behaviour baseline  (~10 s)
//   node tools/verify.mjs --full     also the two original-parity harnesses     (~1 min)
//   node tools/verify.mjs --update   re-record the baseline, then check
//
// It rebuilds index.html first, because that file is generated AND committed:
// edit src/ without re-bundling and the file people double-click drifts from
// the source, with nothing to warn you. Here it gets caught every time.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const flags = new Set(process.argv.slice(2));
const full = flags.has('--full');
const update = flags.has('--update');

const steps = [];

function run(label, script, extra = [])
{
    process.stdout.write(`\n=== ${label} ===\n`);
    const result = spawnSync(process.execPath, [join(root, script), ...extra], { cwd: root, stdio: 'inherit' });
    const ok = result.status === 0;
    steps.push({ label, ok, detail: extra.includes('--update') ? 're-recorded' : '' });
    return ok;
}

// 1. Rebuild the generated entry point, and notice if it had gone stale.
const indexPath = join(root, 'index.html');
const before = readFileSync(indexPath);
const bundled = run('rebuild index.html', 'tools/bundle.mjs');
const stale = bundled && !before.equals(readFileSync(indexPath));

// 2. Behaviour against the recorded baseline - the day-to-day regression net.
if (update)
    run('record behaviour baseline', 'test/baseline.mjs', ['--update']);

const baselineOk = run('behaviour baseline', 'test/baseline.mjs');

// 3. Optionally, the provenance checks against the original demo. These only
//    pass while behaviour is unchanged, so they are opt-in once you start
//    adding features.
let parityOk = true;
let browserOk = true;

if (full) {
    parityOk = run('parity with the original demo', 'test/parity.mjs');
    browserOk = run('rendered output in Chrome', 'test/parity-browser.mjs');
}

// ------------------------------------------------------------------- report

function line(label, ok, detail)
{
    const padding = ' '.repeat(Math.max(0, 30 - label.length));
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${padding}${detail ?? ''}`);
}

console.log('');
console.log('verify');
console.log('  ' + '-'.repeat(70));

line('rebuild index.html', bundled, stale ? 'was stale, regenerated - commit it' : 'already current');
line('behaviour baseline', baselineOk, '');
if (full) {
    line('parity with the original', parityOk, '');
    line('rendered output in Chrome', browserOk, '');
} else {
    console.log('      parity with the original     skipped (--full to include)');
}

console.log('  ' + '-'.repeat(70));

const failed = steps.filter(step => !step.ok).length + (bundled ? 0 : 1);
const skipped = full ? 0 : 2;

console.log('');
if (!bundled) {
    console.log('RESULT: FAIL - the bundler did not run');
} else if (failed || !baselineOk || !parityOk || !browserOk) {
    console.log(`RESULT: FAIL - something above needs attention`);
} else if (stale) {
    console.log('RESULT: PASS - but index.html was stale and has been regenerated; commit it with your change');
} else {
    console.log(`RESULT: PASS - ${steps.length} step(s) clean${skipped ? `, ${skipped} skipped` : ''}`);
}

process.exitCode = (failed || !baselineOk || (full && (!parityOk || !browserOk))) ? 1 : 0;

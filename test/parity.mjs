// Is the current build still byte-identical to the original demo?
//
//   node test/parity.mjs
//
// This is the provenance check: it proves the refactor changed nothing. It can
// only pass while behaviour is unchanged, so it WILL fail the moment a feature
// is added on purpose - that is not breakage, it is the check doing its job.
//
// For day-to-day development use `node test/baseline.mjs`, which compares
// against behaviour you record and update deliberately. See WORKFLOW.md.
//
// The original runs inside a VM with a DOM and WebGL stub, because its script
// needs a document and a GL context before it will do anything. The current
// build is imported directly: its core has no DOM references.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TOGGLES } from '../src/app/UI.js';
import { VERSION } from '../src/version.js';
import {
    VIEWPORT, SCENARIO, loadReference, loadRefactored, domainForViewport,
    runScenario, snapshot, stepReference, stepRefactored
} from './lib/harness.mjs';

const root = new URL('..', import.meta.url);
const refPath = fileURLToPath(new URL('ref/18-flip.html', root));
const refHtml = readFileSync(refPath, 'utf8');
const devHtml = readFileSync(fileURLToPath(new URL('dev.html', root)), 'utf8');
const bundleHtml = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

// ------------------------------------------------------------------ domain

const ref = loadReference(refHtml);
const originalDomain = ref.domain;
const domain = domainForViewport();

check('canvas size',
    ref.canvas.width === VIEWPORT.innerWidth - 20 && ref.canvas.height === VIEWPORT.innerHeight - 20,
    `${ref.canvas.width}x${ref.canvas.height}`);
check('cScale', Object.is(originalDomain.cScale, domain.cScale), String(originalDomain.cScale));
check('simWidth', Object.is(originalDomain.simWidth, domain.simWidth), String(originalDomain.simWidth));
check('simHeight', Object.is(originalDomain.simHeight, domain.simHeight),
    `${originalDomain.simHeight} (module constant)`);

// ------------------------------------------------------------- state parity

const rebuilt = loadRefactored(originalDomain.simWidth, originalDomain.simHeight);
const initialRef = snapshot(ref.scene.fluid, ref.scene);
const initialNew = snapshot(rebuilt.scene.fluid, rebuilt.scene);

const initialDiff = Object.keys(initialRef).filter(key => initialRef[key] !== initialNew[key]);
check('initial state', initialDiff.length === 0,
    initialDiff.length ? `differs: ${initialDiff.join(', ')}` : `${Object.keys(initialRef).length} fields`);

runScenario(ref, () => stepReference(ref.scene));
runScenario(rebuilt, () => stepRefactored(rebuilt.scene));

const finalRef = snapshot(ref.scene.fluid, ref.scene);
const finalNew = snapshot(rebuilt.scene.fluid, rebuilt.scene);

const differing = Object.keys(finalRef).filter(key => finalRef[key] !== finalNew[key]);
check('post-run state', differing.length === 0,
    differing.length ? `differs: ${differing.join(', ')}` : `${Object.keys(finalRef).length} fields`);

// ---------------------------------------------------------- markup and wiring

// The panel must flip the same flags the original's inline handlers flipped,
// and nothing else.
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

// The root entry point is the generated single file: no external references,
// modules and stylesheet inlined, so it runs by double-click.
const bundledModules = (bundleHtml.match(/__mods\["/g) ?? []).length;

check('root index.html is self-contained',
    !/<script[^>]*type\s*=\s*["']module["']/.test(bundleHtml) &&
    !/<script[^>]*\ssrc\s*=/.test(bundleHtml) &&
    !bundleHtml.includes('href="src/') &&
    bundleHtml.includes('__mods[') &&
    bundleHtml.includes('-webkit-appearance'),
    `${(bundleHtml.length / 1024).toFixed(1)} KB, ${bundledModules} modules and app.css inlined`);

check('generated file is version stamped', bundleHtml.includes(`FLIP Fluid v${VERSION}`),
    `v${VERSION} in the header comment`);

// ------------------------------------------------------------------- report

function fmt(label, value, ok)
{
    const padding = ' '.repeat(Math.max(0, 34 - label.length));
    return `${label}${padding}${value}${ok ? '' : '   <-- FAIL'}`;
}

console.log('');
console.log('reference:  ' + refPath);
console.log('current:    ' + fileURLToPath(new URL('index.html', root)));
console.log('');
console.log('deterministic run: ' + SCENARIO);
console.log('');
console.log(fmt('check', 'detail', true));
console.log('-'.repeat(92));

for (const r of results)
    console.log(fmt(r.name, r.detail, r.ok));

console.log('-'.repeat(92));

// Byte-level detail for the two state checks, so a failure is actionable.
for (const [label, a, b] of [['initial', initialRef, initialNew], ['post-run', finalRef, finalNew]]) {
    const diff = Object.keys(a).filter(key => a[key] !== b[key]);
    if (diff.length) {
        console.log('');
        console.log(`${label} state byte diff:`);
        for (const key of diff)
            console.log(`  ${key}\n    reference ${a[key]}\n    current   ${b[key]}`);
    }
}

const failed = results.filter(r => !r.ok);

console.log('');
if (failed.length) {
    console.log(`RESULT: FAIL - ${failed.length} of ${results.length} checks failed`);
    console.log('');
    console.log('If you changed behaviour on purpose this is the wrong check:');
    console.log('use `node test/baseline.mjs --update` to re-record the intended behaviour.');
    process.exitCode = 1;
} else {
    console.log(`RESULT: PASS - all ${results.length} checks match, every simulation array is byte-identical`);
}

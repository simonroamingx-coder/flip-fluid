// Rendered-output parity check.
//
//   node test/parity-browser.mjs
//
// Loads the original file and the refactored build in the same headless Chrome,
// drives both through the identical sequence of steps, and then compares:
//
//   * the GL canvas pixels (read back via toDataURL immediately after a draw)
//   * computed styles and element geometry for the page chrome
//   * the full page screenshot
//   * console errors and uncaught exceptions
//
// A canvas that renders nothing (no WebGL in this environment) is reported
// rather than silently passing.

import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { VERSION } from '../src/version.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = join(root, 'test', 'artifacts');

const CHROME_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const chromePath = CHROME_CANDIDATES.find(existsSync);
if (!chromePath)
    throw new Error('no Chrome or Edge found');

const VIEWPORT = { width: 1280, height: 720 };
const SERVE_PORT = 8099;

const refUrl = 'file:///' + fileURLToPath(new URL('../ref/18-flip.html', import.meta.url)).replace(/\\/g, '/');
const newUrl = `http://127.0.0.1:${SERVE_PORT}/dev.html`;
const standaloneUrl = 'file:///' + fileURLToPath(new URL('../index.html', import.meta.url)).replace(/\\/g, '/');

// --------------------------------------------------------------- drive scripts

// Cheap FNV-1a over a strided sample of the state arrays. Good enough to prove
// two builds are in the same state, and that the state actually changed.
const DIGEST_JS = `
    const digest = arr => {
        let h = 2166136261;
        for (let i = 0; i < arr.length; i += 7) {
            h ^= (Math.round(arr[i] * 1e6) | 0);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(16);
    };
    const stateDigest = s => [s.fluid.particlePos, s.fluid.u, s.fluid.v,
        s.fluid.particleDensity, s.fluid.particleColor].map(digest).join('-');
`;

// Elements that are deliberate additions to the page rather than part of the
// original. They are recorded, then removed before the DOM and screenshot are
// compared, so everything else is still checked exactly against the original.
const ADDITIVE_IDS = ['version', 'panels'];

// Both snippets do exactly the same thing; only the entry point differs.
function driveScript(entry)
{
    return `(() => {
        const S = ${entry}.scene;
        const draw = ${entry}.draw;
        const place = ${entry}.setObstacle;
        ${DIGEST_JS}
        const versionElement = document.getElementById('version');
        const version = versionElement ? versionElement.textContent.trim() : null;
        const additive = ${JSON.stringify(ADDITIVE_IDS)}.filter(id => document.getElementById(id));
        const step = () => S.fluid.simulate(
            S.dt, S.gravity, S.flipRatio, S.numPressureIters, S.numParticleIters,
            S.overRelaxation, S.compensateDrift, S.separateParticles,
            S.obstacleX, S.obstacleY, S.obstacleRadius
            ${entry === 'window.__flip' ? ', S.obstacleVelX, S.obstacleVelY' : ''});

        S.paused = true;
        const initialDigest = stateDigest(S);
        for (let i = 0; i < 30; i++) step();
        for (let i = 0; i < 15; i++) { place(1.5 + 0.06 * i, 1.2 + 0.02 * i, false); step(); }
        for (let i = 0; i < 15; i++) step();

        draw();
        // Recorded above, dropped here, so the comparisons below still describe
        // everything that came from the original.
        for (const id of additive) document.getElementById(id).remove();

        return JSON.stringify({
            initialDigest: initialDigest,
            digest: stateDigest(S),
            frameNr: S.frameNr,
            numParticles: S.fluid.numParticles,
            version: version,
            additive: additive,
            canvas: document.getElementById('myCanvas').toDataURL('image/png')
        });
    })()`;
}

// Exercises the panels for real: check debug starts off, switch it on and read
// the numbers, then move the particle slider and press Apply and check that both
// panels follow the rebuilt scene. Pages without the panels report
// supported: false, which is what the original page should do.
function panelScript()
{
    return `(async () => {
        const slider = document.getElementById('particleSlider');
        const apply = document.getElementById('applyParticles');
        const toggle = document.getElementById('debugEnabled');
        const stats = document.getElementById('debugStats');
        if (!slider || !apply || !toggle || !stats)
            return JSON.stringify({ supported: false });

        const entry = window.__flip;
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        ${DIGEST_JS}

        // debug is off until asked for
        const enabledBefore = toggle.checked;
        const hiddenBefore = stats.hidden;

        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(500);

        const debugStats = { ...entry.debug.stats };
        const debugText = stats.textContent;

        // now rebuild the scene and see whether both panels follow it
        const before = entry.scene.fluid.numParticles;
        slider.value = '12000';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        apply.click();
        await wait(500);

        const after = {
            active: entry.scene.fluid.numParticles,
            resolution: entry.scene.gridResolution,
            particlesInPanel: entry.debug.stats.activeParticles,
            text: stats.textContent
        };

        // let it run for a moment, so the per-stage timings have something to
        // measure: a paused simulation does no work to divide up
        entry.scene.paused = false;
        await wait(900);

        const running = { stats: { ...entry.debug.stats }, text: stats.textContent };

        // The views are compared with the simulation paused, so a difference in
        // the picture can only come from the view rather than from time passing.
        entry.scene.paused = true;
        await wait(250);

        const digestBefore = stateDigest(entry.scene);

        const setView = (id, value) => {
            const input = document.getElementById(id);
            input.checked = value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };

        const picture = async (pressure, cellTypes) => {
            setView('showPressure', pressure);
            setView('showCellTypes', cellTypes);
            await wait(300);
            entry.draw();
            return document.getElementById('myCanvas').toDataURL('image/png');
        };

        const plain = await picture(false, false);
        const pressureView = await picture(true, false);
        const cellsView = await picture(false, true);

        const views = {
            digestUnchanged: digestBefore === stateDigest(entry.scene),
            pressureDiffers: pressureView !== plain,
            cellsDiffer: cellsView !== plain && cellsView !== pressureView
        };

        // Pictures for the record, with the particle overlay off: the fields are
        // what these views are for, and the particles sit right on top of them.
        const hadParticles = entry.scene.showParticles;
        entry.scene.showParticles = false;
        views.pressureField = await picture(true, false);
        views.cellsField = await picture(false, true);
        entry.scene.showParticles = hadParticles;

        // How often the field is recomputed, against how often we are drawing.
        // A field that steps a few times a second is what reads as stutter.
        entry.scene.paused = false;
        await wait(300);

        const windowStart = performance.now();
        const updatesStart = entry.debug.fieldUpdates;
        await wait(1000);
        views.updatesPerSecond = (entry.debug.fieldUpdates - updatesStart)
            / ((performance.now() - windowStart) / 1000);
        views.fpsWithField = entry.debug.stats.fps;

        // And what the view costs: frame rate with it on against with it off.
        setView('showPressure', false);
        setView('showCellTypes', false);
        await wait(900);
        views.fpsWithoutField = entry.debug.stats.fps;

        // Running again, so the screenshot taken after this shows live numbers
        // rather than a paused panel reading zero.
        setView('showCellTypes', true);
        await wait(250);

        // Left running on purpose: the screenshot taken after this shows live
        // numbers rather than a paused panel reading zero.
        entry.draw();

        return JSON.stringify({
            supported: true,
            before: before,
            requested: entry.scene.requestedParticles,
            actual: entry.scene.fluid.numParticles,
            resolution: entry.scene.gridResolution,
            label: document.getElementById('particleValue').textContent,
            report: document.getElementById('particleActual').textContent,
            debug: {
                enabledBefore: enabledBefore,
                hiddenBefore: hiddenBefore,
                stats: debugStats,
                text: debugText
            },
            after: after,
            running: running,
            views: views,
            canvas: document.getElementById('myCanvas').toDataURL('image/png')
        });
    })()`;
}

// Clicks the Grid checkbox and moves the slider, then redraws. The original
// wires these through inline attributes, the refactored build through
// src/app/UI.js - the resulting scene state and pixels must match.
function controlScript(entry)
{
    return `(() => {
        const S = ${entry}.scene;
        ${DIGEST_JS}
        const inputs = [...document.querySelectorAll('input')];
        const grid = inputs.find(i => i.type === 'checkbox' && !i.checked);
        grid.click();
        const slider = inputs.find(i => i.type === 'range');
        slider.value = '5';
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        ${entry}.draw();
        return JSON.stringify({
            gridChecked: grid.checked,
            showGrid: S.showGrid,
            flipRatio: S.flipRatio,
            digest: stateDigest(S),
            canvas: document.getElementById('myCanvas').toDataURL('image/png')
        });
    })()`;
}

const probeScript = `(() => {
    const q = s => document.querySelector(s);
    const box = el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 1000) / 1000); };
    const style = el => { const c = getComputedStyle(el);
        return [c.fontFamily, c.fontSize, c.fontWeight, c.borderTopWidth, c.borderTopStyle, c.borderTopColor,
                c.width, c.height, c.appearance, c.opacity, c.backgroundImage, c.borderRadius]; };
    const inputs = [...document.querySelectorAll('input')];
    const canvas = q('#myCanvas');
    return JSON.stringify({
        inner: [innerWidth, innerHeight],
        canvasBox: box(canvas),
        canvasBacking: [canvas.width, canvas.height],
        canvasStyle: style(canvas),
        bodyStyle: style(document.body),
        inputCount: inputs.length,
        inputBoxes: inputs.map(box),
        inputStyles: inputs.map(style),
        inputTypes: inputs.map(i => i.type),
        inputChecks: inputs.map(i => i.checked),
        inputValues: inputs.map(i => i.value),
        sliderClass: q('input[type=range]').className,
        text: document.body.innerText.replace(/\\s+/g, ' ').trim(),
        childNodes: [...document.body.childNodes].map(n => n.nodeType === 3 ? '#' + n.textContent.replace(/\\s+/g, '') : n.nodeName).filter(s => s !== '#')
    });
})()`;

// The state a visitor sees the moment the page finishes loading: paused, one
// bootstrap frame drawn. draw() is called immediately before the readback
// because the context is not created with preserveDrawingBuffer.
function initialScript(entry)
{
    return `(() => {
        const S = ${entry}.scene;
        ${DIGEST_JS}
        ${entry}.draw();
        return JSON.stringify({
            frameNr: S.frameNr,
            paused: S.paused,
            digest: stateDigest(S),
            canvas: document.getElementById('myCanvas').toDataURL('image/png')
        });
    })()`;
}

// --------------------------------------------------------------- tiny CDP client

class Cdp
{
    constructor(socket)
    {
        this.socket = socket;
        this.nextId = 1;
        this.pending = new Map();
        this.closed = null;
        this.events = [];
        this.listeners = new Map();

        socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.id && this.pending.has(message.id)) {
                const { resolve, reject } = this.pending.get(message.id);
                this.pending.delete(message.id);
                message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
            } else if (message.method) {
                this.events.push(message);
                const fn = this.listeners.get(message.method);
                if (fn)
                    fn(message.params);
            }
        });

        // If the browser goes away mid-command, fail the pending calls instead
        // of waiting out their timeouts. Without this a dead browser looks like
        // a hung test.
        socket.addEventListener('close', () => {
            this.closed = this.closed ?? new Error('the browser closed the connection');
            for (const { reject } of this.pending.values())
                reject(this.closed);
            this.pending.clear();
        });
    }

    on(method, fn)
    {
        this.listeners.set(method, fn);
    }

    send(method, params = {})
    {
        if (this.closed)
            return Promise.reject(this.closed);

        const id = this.nextId++;
        return withTimeout(
            new Promise((resolve, reject) => {
                this.pending.set(id, { resolve, reject });
                this.socket.send(JSON.stringify({ id, method, params }));
            }),
            600000,
            method);
    }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function withTimeout(promise, ms, label)
{
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out: ' + label)), ms))
    ]);
}

async function waitFor(fn, timeoutMs, label)
{
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await fn();
        if (value)
            return value;
        if (Date.now() > deadline)
            throw new Error('timed out waiting for ' + label);
        await sleep(120);
    }
}

// --------------------------------------------------------------- page session

async function openPage(cdp, url, entry)
{
    const errors = [];
    const onMessage = params => {
        if (params.type === 'error' || params.type === 'assert')
            errors.push(params.args?.map(a => a.value ?? a.description).join(' ') ?? params.type);
    };
    const onException = params => {
        errors.push('uncaught: ' + (params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text));
    };

    cdp.on('Log.entryAdded', onMessage);
    cdp.on('Runtime.consoleAPICalled', params => {
        if (params.type === 'error')
            errors.push('console.error: ' + params.args.map(a => a.value ?? a.description).join(' '));
        else if (params.type === 'log' || params.type === 'warning')
            errors.push('console.' + params.type + ': ' + params.args.map(a => a.value ?? a.description).join(' '));
    });
    cdp.on('Runtime.exceptionThrown', onException);

    await cdp.send('Page.navigate', { url });
    console.log('  navigated: ' + url);

    await waitFor(async () => {
        const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
        return result.value === 'complete';
    }, 20000, 'page load');

    await waitFor(async () => {
        const { result } = await cdp.send('Runtime.evaluate', {
            expression: `Boolean(${entry} && ${entry}.scene && ${entry}.scene.fluid)`, returnByValue: true
        });
        return result.value === true;
    }, 20000, entry);

    const webgl = (await cdp.send('Runtime.evaluate', {
        expression: `Boolean(document.createElement('canvas').getContext('webgl'))`, returnByValue: true
    })).result.value;

    const loaded = JSON.parse((await cdp.send('Runtime.evaluate', {
        expression: initialScript(entry), returnByValue: true
    })).result.value);

    const driven = JSON.parse((await cdp.send('Runtime.evaluate', {
        expression: driveScript(entry), returnByValue: true, awaitPromise: false
    })).result.value);
    console.log('  driven and drawn');

    const probe = JSON.parse((await cdp.send('Runtime.evaluate', {
        expression: probeScript, returnByValue: true
    })).result.value);

    const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;

    const controlled = JSON.parse((await cdp.send('Runtime.evaluate', {
        expression: controlScript(entry), returnByValue: true
    })).result.value);
    console.log('  controls exercised');

    // A fresh visit, because applying a particle count changes the scene and the
    // panel has already been removed from the page above.
    await cdp.send('Page.navigate', { url });
    await waitFor(async () => {
        const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
        return result.value === 'complete';
    }, 20000, 'page load');
    await waitFor(async () => {
        const { result } = await cdp.send('Runtime.evaluate', {
            expression: `Boolean(${entry} && ${entry}.scene && ${entry}.scene.fluid)`, returnByValue: true
        });
        return result.value === true;
    }, 20000, entry);

    const settings = JSON.parse((await cdp.send('Runtime.evaluate', {
        expression: panelScript(), returnByValue: true, awaitPromise: true
    })).result.value);
    console.log('  panels exercised');

    const settingsShot = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;

    return {
        url, errors, webgl, loaded, driven, controlled, settings, probe,
        shot: Buffer.from(shot, 'base64'),
        settingsShot: Buffer.from(settingsShot, 'base64')
    };
}

// --------------------------------------------------------------- png diff

function decodePng(buffer)
{
    let offset = 8;
    let width = 0, height = 0, bitDepth = 0, colorType = 0;
    const idat = [];

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);

        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        offset += length + 12;
    }

    if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2))
        throw new Error(`unsupported png: depth ${bitDepth} color ${colorType}`);

    const channels = colorType === 6 ? 4 : 3;
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const out = Buffer.alloc(height * stride);

    let pos = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[pos++];
        const line = raw.subarray(pos, pos + stride);
        pos += stride;

        const cur = out.subarray(y * stride, (y + 1) * stride);
        const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);

        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? cur[x - channels] : 0;
            const b = prev[x];
            const c = x >= channels ? prev[x - channels] : 0;
            let value = line[x];

            if (filter === 1) value += a;
            else if (filter === 2) value += b;
            else if (filter === 3) value += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            }
            cur[x] = value & 0xff;
        }
    }

    return { width, height, channels, data: out };
}

function comparePng(a, b)
{
    if (a.equals(b))
        return { identical: true, differing: 0, maxDelta: 0, meanDelta: 0 };

    const left = decodePng(a);
    const right = decodePng(b);

    if (left.width !== right.width || left.height !== right.height)
        return { identical: false, error: `size differs: ${left.width}x${left.height} vs ${right.width}x${right.height}` };

    let differing = 0, maxDelta = 0, totalDelta = 0;
    const pixels = left.width * left.height;

    for (let i = 0; i < pixels; i++) {
        let delta = 0;
        for (let c = 0; c < 3; c++) {
            const l = left.data[i * left.channels + c];
            const r = right.data[i * right.channels + c];
            delta = Math.max(delta, Math.abs(l - r));
        }
        if (delta > 0) {
            differing++;
            totalDelta += delta;
        }
        maxDelta = Math.max(maxDelta, delta);
    }

    return { identical: false, differing, pixels, maxDelta, meanDelta: totalDelta / pixels };
}

// --------------------------------------------------------------- run

const profile = await mkdtemp(join(tmpdir(), 'flip-parity-'));
await mkdir(artifacts, { recursive: true });

const server = spawn(process.execPath, [join(root, 'tools', 'serve.mjs'), String(SERVE_PORT)], { stdio: 'ignore' });

const chrome = spawn(chromePath, [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-component-update',
    // The GPU sandbox cannot start inside a restricted filesystem sandbox and
    // crashes the GPU process repeatedly; these keep headless Chrome alive.
    // WebGL then falls back to SwiftShader, which is what the parity renders use.
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-dev-shm-usage',
    '--disable-crash-reporter',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    'about:blank'
], { stdio: 'ignore' });

chrome.on('exit', code => console.log(`  (chrome exited with code ${code})`));

function kill(child)
{
    if (!child.pid || child.killed)
        return Promise.resolve();
    return new Promise(resolve => {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => resolve());
    });
}

let exitCode = 0;

try {
    const portFile = await waitFor(async () => {
        const file = join(profile, 'DevToolsActivePort');
        return existsSync(file) ? file : null;
    }, 30000, 'DevToolsActivePort');

    const port = (await readFile(portFile, 'utf8')).split('\n')[0].trim();

    const targets = await waitFor(async () => {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/list`);
            const list = await response.json();
            return list.find(t => t.type === 'page') ? list : null;
        } catch {
            return null;
        }
    }, 20000, 'debug target');

    const target = targets.find(t => t.type === 'page');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await withTimeout(new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve);
        socket.addEventListener('error', reject);
        socket.addEventListener('close', () => reject(new Error('socket closed before opening')));
    }), 30000, 'websocket open');

    const cdp = new Cdp(socket);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    const original = await openPage(cdp, refUrl, 'window');
    const refactored = await openPage(cdp, newUrl, 'window.__flip');
    const standalone = await openPage(cdp, standaloneUrl, 'window.__flip');

    await writeFile(join(artifacts, 'original.png'), original.shot);
    await writeFile(join(artifacts, 'refactored.png'), refactored.shot);
    await writeFile(join(artifacts, 'standalone.png'), standalone.shot);
    await writeFile(join(artifacts, 'settings-applied-standalone.png'), standalone.settingsShot);
    await writeFile(join(artifacts, 'view-pressure.png'),
        Buffer.from(standalone.settings.views.pressureField.split(',')[1], 'base64'));
    await writeFile(join(artifacts, 'view-cell-types.png'),
        Buffer.from(standalone.settings.views.cellsField.split(',')[1], 'base64'));

    const checks = [];
    const check = (name, ok, detail) => checks.push({ name, ok, detail });

    const pngOf = dataUrl => Buffer.from(dataUrl.split(',')[1], 'base64');
    const blank = dataUrl => decodePng(pngOf(dataUrl)).data.every(byte => byte === 0);
    const probeDiffOf = page => Object.keys(original.probe).filter(key =>
        JSON.stringify(original.probe[key]) !== JSON.stringify(page.probe[key]));
    const short = hash => hash.length > 24 ? hash.slice(0, 24) + '...' : hash;

    check('webgl available', original.webgl && refactored.webgl && standalone.webgl,
        `original=${original.webgl} modules=${refactored.webgl} standalone=${standalone.webgl}`);

    check('canvas rendered something',
        !blank(original.driven.canvas) && !blank(refactored.driven.canvas) && !blank(standalone.driven.canvas),
        'all three canvases contain non-zero pixels');

    check('simulation advanced',
        original.driven.initialDigest !== original.driven.digest &&
        refactored.driven.initialDigest !== refactored.driven.digest &&
        standalone.driven.initialDigest !== standalone.driven.digest,
        `${original.driven.numParticles} particles, ${short(original.driven.initialDigest)} -> ${short(original.driven.digest)}`);

    check('version badge',
        refactored.driven.version === 'v' + VERSION &&
        standalone.driven.version === 'v' + VERSION &&
        original.driven.version === null,
        `dev.html and index.html show v${VERSION}; the original shows none`);

    const withCommas = value => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    check('settings panel present',
        refactored.settings.supported && standalone.settings.supported && !original.settings.supported,
        'dev.html and index.html have it; the original does not');

    check('settings apply a new particle count',
        [refactored, standalone].every(page =>
            page.settings.requested === 12000 &&
            page.settings.actual !== page.settings.before &&
            Math.abs(page.settings.actual - 12000) / 12000 < 0.05),
        `asked 12,000 of ${withCommas(refactored.settings.before)}, got ${withCommas(refactored.settings.actual)} `
        + `at grid ${refactored.settings.resolution}`);

    check('settings panel reports what it got',
        [refactored, standalone].every(page => page.settings.report.includes(withCommas(page.settings.actual))),
        `"${refactored.settings.report}"`);

    check('rebuilt scene renders',
        [refactored, standalone].every(page => !blank(page.settings.canvas)),
        'renderer buffers follow the new grid and particle sizes, so the scene still draws');

    check('debug panel present',
        refactored.settings.debug && standalone.settings.debug && !original.settings.debug,
        'dev.html and index.html have it; the original does not');

    check('debug is off until asked for',
        [refactored, standalone].every(page =>
            page.settings.debug.enabledBefore === false && page.settings.debug.hiddenBefore === true),
        'nothing is collected or shown until the toggle is switched on');

    check('debug shows runtime numbers',
        [refactored, standalone].every(page => {
            const stats = page.settings.debug.stats;
            return stats.fps > 0 && stats.frameTime > 0
                && stats.activeParticles > 0 && stats.gridCells > 0
                // fluid cells must be a real subset, not the whole grid: an
                // unclassified grid reads as all-fluid because FLUID_CELL is 0
                && stats.fluidCells > 0 && stats.fluidCells < stats.gridCells * 0.95;
        }),
        `${refactored.settings.debug.stats.fps.toFixed(1)} fps, `
        + `${refactored.settings.debug.stats.frameTime.toFixed(1)} ms frame, `
        + `${withCommas(refactored.settings.debug.stats.fluidCells)} fluid of `
        + `${withCommas(refactored.settings.debug.stats.gridCells)} cells`);

    check('debug panel shows those numbers',
        [refactored, standalone].every(page =>
            page.settings.debug.text.includes('FPS') && page.settings.debug.text.includes('Fluid Cells')),
        'the panel is reporting, not just the object behind it');

    check('panels follow a scene rebuild',
        [refactored, standalone].every(page =>
            page.settings.after.particlesInPanel === page.settings.after.active &&
            page.settings.after.active === page.settings.actual),
        `after Apply the panel reads ${withCommas(refactored.settings.after.active)} particles, `
        + `the scene has the same`);

    const stageSum = stats => stats.particleTime + stats.particleToGridTime + stats.pressureTime
        + stats.gridToParticleTime + stats.collisionTime + stats.otherTime;

    const describeRunning = page => {
        const stats = page.settings.running.stats;
        return `sim ${stats.simulationTime.toFixed(1)}, pressure ${stats.pressureTime.toFixed(1)}, `
            + `particles ${stats.particleTime.toFixed(1)}, stages ${stageSum(stats).toFixed(1)}`;
    };

    check('stage timings appear while running',
        [refactored, standalone].every(page =>
            page.settings.running.stats.simulationTime > 0 &&
            page.settings.running.stats.pressureTime > 0 &&
            page.settings.running.stats.particleTime > 0),
        `dev [${describeRunning(refactored)}]  standalone [${describeRunning(standalone)}]`);

    check('stage timings fit inside the step',
        [refactored, standalone].every(page => {
            const stats = page.settings.running.stats;
            const sum = stageSum(stats);
            return sum > 0 && sum <= stats.simulationTime * 1.05;
        }),
        `dev [${describeRunning(refactored)}]  standalone [${describeRunning(standalone)}]`);

    check('debug panel lists the stages',
        [refactored, standalone].every(page =>
            page.settings.running.text.includes('Pressure Solve') &&
            page.settings.running.text.includes('Particle to Grid') &&
            page.settings.running.text.includes('Grid to Particle')),
        `dev panel has it: ${refactored.settings.running.text.includes('Pressure Solve')}, `
        + `standalone panel has it: ${standalone.settings.running.text.includes('Pressure Solve')}`);

    check('debug views change the picture',
        [refactored, standalone].every(page =>
            page.settings.views.pressureDiffers && page.settings.views.cellsDiffer),
        'pressure and cell types each draw something different from the plain view, and from each other');

    check('debug views do not change the simulation',
        [refactored, standalone].every(page => page.settings.views.digestUnchanged),
        'switching views on and off leaves the simulation state untouched');

    // The field is recomputed per drawn frame rather than at the panel's refresh
    // rate. Stepping it a few times a second is what made it look like stutter.
    check('the field is refreshed every frame',
        [refactored, standalone].every(page =>
            page.settings.views.updatesPerSecond > page.settings.views.fpsWithField * 0.8),
        `dev ${refactored.settings.views.updatesPerSecond.toFixed(0)} updates/s at `
        + `${refactored.settings.views.fpsWithField.toFixed(0)} fps, `
        + `standalone ${standalone.settings.views.updatesPerSecond.toFixed(0)} at `
        + `${standalone.settings.views.fpsWithField.toFixed(0)}`);

    check('a field view is not a frame-rate cliff',
        [refactored, standalone].every(page =>
            page.settings.views.fpsWithField > page.settings.views.fpsWithoutField * 0.6),
        `dev ${refactored.settings.views.fpsWithField.toFixed(0)} fps with the view, `
        + `${refactored.settings.views.fpsWithoutField.toFixed(0)} without`);

    const probeDiffs = new Map();

    // Every build is compared against the original, on the same axes.
    function compareAgainst(label, page)
    {
        const controlsMatch = ['gridChecked', 'showGrid', 'flipRatio']
            .every(key => JSON.stringify(original.controlled[key]) === JSON.stringify(page.controlled[key]));
        const probeDiff = probeDiffOf(page);
        const shotDiff = comparePng(original.shot, page.shot);
        probeDiffs.set(label, probeDiff);

        check(`${label}: on-load frame`,
            page.loaded.canvas === original.loaded.canvas && page.loaded.digest === original.loaded.digest,
            `paused=${original.loaded.paused} digest ${short(original.loaded.digest)}`);

        check(`${label}: simulation state`, page.driven.digest === original.driven.digest,
            page.driven.digest === original.driven.digest
                ? `identical digest ${short(page.driven.digest)}`
                : `${short(original.driven.digest)} vs ${short(page.driven.digest)}`);

        check(`${label}: canvas pixels`, page.driven.canvas === original.driven.canvas,
            page.driven.canvas === original.driven.canvas
                ? `identical, ${createHash('sha256').update(pngOf(page.driven.canvas)).digest('hex').slice(0, 16)}`
                : 'canvas PNG differs');

        check(`${label}: controls take effect`, controlsMatch &&
            page.controlled.gridChecked === true && page.controlled.showGrid === true &&
            page.controlled.flipRatio === 0.5,
            `showGrid=${page.controlled.showGrid} flipRatio=${page.controlled.flipRatio} checked=${page.controlled.gridChecked}`);

        check(`${label}: grid pass`, page.controlled.canvas === original.controlled.canvas &&
            page.controlled.canvas !== page.driven.canvas,
            page.controlled.canvas === original.controlled.canvas
                ? 'grid pass renders identically'
                : 'canvas PNG differs');

        check(`${label}: page chrome`, probeDiff.length === 0,
            probeDiff.length ? `differs: ${probeDiff.join(', ')}` : `${Object.keys(original.probe).length} fields`);

        check(`${label}: screenshot`, shotDiff.identical,
            shotDiff.identical ? `identical, ${original.shot.length} bytes`
                : `${shotDiff.differing}/${shotDiff.pixels} pixels differ, max channel delta ${shotDiff.maxDelta}`);

        check(`${label}: console clean`, page.errors.length === 0,
            `${page.errors.length} errors`);
    }

    compareAgainst('modules', refactored);
    compareAgainst('standalone', standalone);

    console.log('');
    console.log('chrome: ' + chromePath);
    console.log('original:   ' + original.url);
    console.log('modules:    ' + refactored.url);
    console.log('standalone: ' + standalone.url);
    console.log('');
    console.log('check                              detail');
    console.log('-'.repeat(92));
    for (const c of checks) {
        const padding = ' '.repeat(Math.max(0, 34 - c.name.length));
        console.log(`${c.name}${padding}${c.detail}${c.ok ? '' : '   <-- FAIL'}`);
    }
    console.log('-'.repeat(92));

    for (const [label, probeDiff] of probeDiffs) {
        if (!probeDiff.length)
            continue;
        console.log('');
        console.log(`probe differences (${label} vs original):`);
        for (const key of probeDiff)
            console.log(`  ${key}\n    original ${JSON.stringify(original.probe[key])}\n    ${label} ${JSON.stringify(refactored.probe[key])}`);
    }

    for (const page of [original, refactored, standalone]) {
        if (page.errors.length) {
            console.log('');
            console.log('console output from ' + page.url + ':');
            for (const e of page.errors)
                console.log('  ' + e);
        }
    }

    console.log('');
    console.log('screenshots: ' + artifacts);

    const failed = checks.filter(c => !c.ok);
    if (failed.length) {
        console.log(`RESULT: FAIL - ${failed.length} of ${checks.length} checks failed`);
        exitCode = 1;
    } else {
        console.log(`RESULT: PASS - all ${checks.length} checks match`);
    }
} catch (error) {
    console.error('harness error: ' + error.message);
    exitCode = 1;
} finally {
    await kill(chrome);
    await kill(server);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
}

process.exit(exitCode);

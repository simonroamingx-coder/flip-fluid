// Builds index.html: one self-contained file that runs by double-click, with no
// server. The source of truth is dev.html plus the modules in src/; this inlines
// both into the root entry point.
//
//   node tools/bundle.mjs
//
// The transform is deliberately narrow. It handles named imports from relative
// paths and exported function/const/class declarations, which is all this
// codebase uses, and refuses to build if it meets anything else rather than
// emitting a bundle it cannot vouch for.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { posix } from 'node:path';

const root = new URL('..', import.meta.url);
const rootPath = fileURLToPath(root);

const IMPORT_RE = /^[ \t]*import\s*\{([^}\n]*)\}\s*from\s*['"](\.[^'"\n]+)['"]\s*;?[ \t]*$/gm;
const EXPORT_RE = /^[ \t]*export\s+(function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm;
const ANY_IMPORT_RE = /^[ \t]*import\s/m;
const ANY_EXPORT_RE = /^[ \t]*export\s/m;

const modules = new Map();

async function load(key)
{
    if (modules.has(key))
        return modules.get(key);

    const source = await readFile(new URL(key, root), 'utf8');
    const record = { key, source, code: null, deps: [], exports: [] };
    modules.set(key, record);

    const dir = posix.dirname(key);
    const exported = new Set();

    const code = source
        .replace(IMPORT_RE, (match, names, specifier) => {
            const resolved = posix.normalize(posix.join(dir, specifier));
            record.deps.push(resolved);

            const bindings = names.split(',').map(name => name.trim()).filter(Boolean);
            for (const binding of bindings) {
                if (!/^[A-Za-z0-9_$]+$/.test(binding))
                    throw new Error(`unsupported import binding "${binding}" in ${key}`);
            }

            return `const { ${bindings.join(', ')} } = __req(${JSON.stringify(resolved)});`;
        })
        .replace(EXPORT_RE, (match, kind, name) => {
            exported.add(name);
            return `${kind} ${name}`;
        });

    if (ANY_IMPORT_RE.test(code))
        throw new Error(`unsupported import statement left in ${key}`);
    if (ANY_EXPORT_RE.test(code))
        throw new Error(`unsupported export statement left in ${key}`);
    if (code.includes('</script'))
        throw new Error(`${key} contains a literal </script sequence`);

    record.exports = [...exported];
    record.code = code;

    await Promise.all(record.deps.map(load));

    return record;
}

function emit(record)
{
    const assignments = record.exports.map(name => `\t__exports.${name} = ${name};`).join('\n');
    return `__mods[${JSON.stringify(record.key)}] = function (__exports, __req) {\n`
        + `"use strict";\n${record.code}\n${assignments}\n};`;
}

// Depth-first, dependencies first.
function order(record, seen = new Set(), out = [])
{
    if (seen.has(record.key))
        return out;
    seen.add(record.key);
    for (const dep of record.deps)
        order(modules.get(dep), seen, out);
    out.push(record);
    return out;
}

const entry = await load('src/main.js');
const html = await readFile(new URL('dev.html', root), 'utf8');
const css = await readFile(new URL('src/styles/app.css', root), 'utf8');

if (css.includes('</style'))
    throw new Error('app.css contains a literal </style sequence');

const runtime = `var __mods = {}, __cache = {};
function __req(key) {
    if (Object.prototype.hasOwnProperty.call(__cache, key))
        return __cache[key];
    var __exports = __cache[key] = {};
    __mods[key](__exports, __req);
    return __exports;
}`;

const bundle = [runtime, ...order(entry).map(emit), '__req("src/main.js");'].join('\n\n');

let output = html
    .replace(/[ \t]*<link rel="stylesheet" href="src\/styles\/app\.css">\r?\n/,
        `\t\t<style>\n${css}\n\t\t</style>\n`)
    .replace(/[ \t]*<script type="module" src="src\/main\.js"><\/script>/,
        `\t<script>\n${bundle}\n\t</script>`);

// Comments marked dev-only describe the development entry point and would be
// misleading in the generated file, so they are dropped here.
output = output.replace(/[ \t]*<!-- build:dev-only -->[\s\S]*?<!-- \/build:dev-only -->\r?\n/, '');

if (output.includes('<script type="module"') || output.includes('href="src/styles/app.css"'))
    throw new Error('index.html still references external sources after inlining');
if (output.includes('build:dev-only'))
    throw new Error('a dev-only block was not stripped');

output = output.replace('<title>FLIP Fluid</title>',
    '<title>FLIP Fluid</title>\n\t\t<!-- Built by tools/bundle.mjs from the modules in src/. Do not edit by hand. -->');

await writeFile(new URL('index.html', root), output);

const list = order(entry).map(record => record.key);
console.log(`bundled ${list.length} modules from dev.html into index.html`);
console.log(`  ${list.join('\n  ')}`);
console.log(`  ${(output.length / 1024).toFixed(1)} KB, opens directly from disk`);

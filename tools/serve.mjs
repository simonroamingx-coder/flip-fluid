// Minimal static file server. ES modules cannot be loaded from a file:// page,
// so the app has to be served over http. No dependencies.
//
//   node tools/serve.mjs [port]

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] ?? 8080);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/'))
        pathname += 'index.html';

    const target = join(root, normalize(pathname));

    if (!target.startsWith(root)) {
        res.writeHead(403).end('forbidden');
        return;
    }

    try {
        const body = await readFile(target);
        res.writeHead(200, {
            'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
            'cache-control': 'no-store'
        });
        res.end(body);
    } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found: ' + pathname);
    }
});

server.listen(port, () => {
    console.log(`serving ${root}`);
    console.log(`  http://localhost:${port}/index.html`);
});

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requestedPort = Number(process.argv[2] || process.env.PORT || 4173);
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 4173;

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

function resolveRequestPath(urlValue) {
  const url = new URL(urlValue, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolvedPath = path.resolve(root, relativePath);

  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolvedPath;
}

const server = http.createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method Not Allowed');
    return;
  }

  const filePath = resolveRequestPath(request.url);
  if (!filePath) {
    response.writeHead(400);
    response.end('Bad Request');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase());
    if (!contentType) {
      response.writeHead(415, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Unsupported Media Type');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': stats.size,
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fs.createReadStream(filePath).pipe(response);
  });
});

server.on('error', (error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Kokolog dev server: http://127.0.0.1:${port}\n`);
});

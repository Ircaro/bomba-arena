import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function fileSize(file: string): Promise<number | null> {
  try {
    const info = await stat(file);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

function finish(response: ServerResponse, status: number): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(String(status));
}

export async function serveStatic(root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    finish(response, 405);
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    finish(response, 400);
    return;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) {
    finish(response, 400);
    return;
  }

  const base = path.resolve(root);
  let target = path.resolve(base, `.${path.posix.normalize(pathname)}`);
  if (target !== base && !target.startsWith(base + path.sep)) {
    finish(response, 403);
    return;
  }

  let size = await fileSize(target);
  if (size === null && (target === base || !path.extname(target))) {
    target = path.join(base, 'index.html');
    size = await fileSize(target);
  }
  if (size === null) {
    finish(response, 404);
    return;
  }

  const immutable = target.startsWith(path.join(base, 'assets') + path.sep);
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(target).pipe(response);
}

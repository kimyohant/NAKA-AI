/**
 * The Workers Assets binding (env.ASSETS) on the local disk: serves public/ the way wrangler's
 * default html_handling ("auto-trailing-slash") does — /create/ → create/index.html, /login →
 * login.html, /create → 307 /create/ when only create/index.html exists. ETag + 304, no listing.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.wasm': 'application/wasm', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.pck': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.webmanifest': 'application/manifest+json',
};

export function assetsFetcher(root: string): { fetch(request: Request): Promise<Response> } {
  const base = path.resolve(root);
  const file = (p: string) => {
    const full = path.resolve(base, '.' + p);
    if (full !== base && !full.startsWith(base + path.sep)) return null; // no ../ escapes
    return existsSync(full) && statSync(full).isFile() ? full : null;
  };

  return {
    async fetch(request: Request): Promise<Response> {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
      const url = new URL(request.url);
      let pathname: string;
      try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Bad Request', { status: 400 }); }

      let found = pathname.endsWith('/') ? file(pathname + 'index.html') : file(pathname);
      if (!found && !pathname.endsWith('/')) {
        if (file(pathname + '/index.html')) {
          return new Response(null, { status: 307, headers: { Location: url.pathname + '/' + url.search } });
        }
        found = file(pathname + '.html');
      }
      if (!found) return new Response('Not Found', { status: 404 });

      const stat = statSync(found);
      const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
      const headers = new Headers({
        'Content-Type': TYPES[path.extname(found).toLowerCase()] ?? 'application/octet-stream',
        ETag: etag,
        'Cache-Control': 'public, max-age=0, must-revalidate',
      });
      if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
      headers.set('Content-Length', String(stat.size));
      const body = request.method === 'HEAD' ? null : (Readable.toWeb(createReadStream(found)) as unknown as ReadableStream);
      return new Response(body, { status: 200, headers });
    },
  };
}

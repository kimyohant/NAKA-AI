// Static pages as served (env.ASSETS). "/" reaches the Worker first (wrangler.jsonc run_worker_first, server/node.ts)
// so its clip gallery can follow the back office (src/content/showcase.ts). The announcement line is loaded by
// /account-menu.js on the pages customers use, so no other page needs to pass through here.
// The home page has no ETag: the file's would not describe the gallery served with it.
import type { Env } from '../types';
import { homeWithGallery } from './showcase';

export async function serveAsset(request: Request, env: Env, url: URL): Promise<Response> {
  const home = (request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html');
  if (!home) return env.ASSETS.fetch(request);
  // ask for the whole file: a 304 for the file would skip the gallery that changes without it
  const headers = new Headers(request.headers);
  headers.delete('If-None-Match'); headers.delete('If-Modified-Since');
  const response = await env.ASSETS.fetch(new Request(request.url, { method: request.method, headers }));
  if (response.status !== 200 || !(response.headers.get('Content-Type') ?? '').startsWith('text/html')) return response;
  const page = await homeWithGallery(env, await response.text());
  const out = new Headers(response.headers);
  out.delete('ETag'); out.delete('Content-Length');
  out.set('Cache-Control', 'no-cache');
  return new Response(request.method === 'HEAD' ? null : page, { status: 200, headers: out });
}

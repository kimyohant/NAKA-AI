/**
 * naka-ai (apps/landing) on Node in Docker (docs/adr/0002, docs/adr/0004).
 *
 * Runs the unchanged Worker (src/index.ts: fetch + scheduled) with the bindings it expects:
 *   env.DB      D1 API on PostgreSQL (DATABASE_URL)          — src/db/pg-d1.ts + server/postgres.ts
 *   env.ASSETS  public/ from disk                             — server/assets.ts
 *   env.MEDIA   R2 API on a directory, when MEDIA_DIR is set  — server/media.ts
 *   ctx.waitUntil  tracked, awaited on shutdown
 *   cron        scheduled() at the top of every minute, like the "* * * * *" trigger
 * Everything else comes from process.env (what wrangler vars + secrets used to provide).
 *
 * NAKA_ROLE=web | cron | all (default all: one container serves and runs the minute job).
 */
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import worker from '../src/index';
import { d1OnPostgres } from '../src/db/pg-d1';
import type { Env } from '../src/types';
import { assetsFetcher } from './assets';
import { diskBucket } from './media';
import { migrate } from './migrate';
import { connect } from './postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const role = (process.env.NAKA_ROLE ?? 'all').toLowerCase();
const port = Number(process.env.PORT ?? 8788);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required (postgres://account_app:…@postgres:5432/naka)');
const database = connect(databaseUrl, { schema: process.env.DB_SCHEMA ?? 'account' });

const env = {
  ...process.env,
  DB: d1OnPostgres(database.executor),
  ASSETS: assetsFetcher(path.join(root, 'public')),
  ...(process.env.MEDIA_DIR ? { MEDIA: diskBucket(process.env.MEDIA_DIR) } : {}),
} as unknown as Env;

// ctx.waitUntil: background work after a response; awaited before the process exits.
const pending = new Set<Promise<unknown>>();
const ctx = {
  waitUntil(promise: Promise<unknown>) {
    const p = promise.catch(err => console.error('waitUntil failed', err));
    pending.add(p);
    p.finally(() => pending.delete(p));
  },
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

/** Behind Caddy/Cloudflare the socket is plain http on an internal host: rebuild the public URL
 * from X-Forwarded-Proto / Host so Origin checks and redirects see https://naka-ai.com. */
function publicUrl(req: http.IncomingMessage): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? `localhost:${port}`).split(',')[0].trim();
  return `${proto === 'https' ? 'https' : 'http'}://${host}${req.url ?? '/'}`;
}

function toRequest(req: http.IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(publicUrl(req), {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);
}

async function send(res: http.ServerResponse, response: Response, method: string) {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => { if (name !== 'set-cookie') headers[name] = value; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  if (!response.body || method === 'HEAD') { res.end(); return; }
  Readable.fromWeb(response.body as never).pipe(res);
}

/** Like run_worker_first ["/api/*", "/webhook/*"]: those go to the Worker, everything else to the
 * static files first and to the Worker only when no file matches. */
async function handle(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/api/') && !pathname.startsWith('/webhook/')) {
    const asset = await env.ASSETS.fetch(request as never);
    if (asset.status !== 404) return asset as unknown as Response;
  }
  return worker.fetch!(request as never, env, ctx) as unknown as Response;
}

let server: http.Server | undefined;
let timer: NodeJS.Timeout | undefined;

async function main() {
if (process.env.DB_MIGRATE !== '0') {
  const applied = await migrate(database.sql, path.join(root, 'migrations', 'pg'));
  if (applied.length) console.log('migrations applied:', applied.join(', '));
}

if (role === 'web' || role === 'all') {
  server = http.createServer(async (req, res) => {
    try {
      await send(res, await handle(toRequest(req)), req.method ?? 'GET');
    } catch (err) {
      console.error('request failed', err);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal error' }));
    }
  });
  server.listen(port, () => console.log(`naka-ai landing on :${port} (role ${role})`));
}

if (role === 'cron' || role === 'all') {
  const tick = () => {
    const controller = { scheduledTime: Date.now(), cron: '* * * * *', noRetry() {} } as unknown as ScheduledController;
    Promise.resolve(worker.scheduled!(controller, env, ctx)).catch(err => console.error('scheduled failed', err));
  };
  const untilNextMinute = () => 60_000 - (Date.now() % 60_000);
  const loop = () => { tick(); timer = setTimeout(loop, untilNextMinute()); };
  timer = setTimeout(loop, untilNextMinute());
  console.log('cron: every minute');
}
}

async function shutdown(signal: string) {
  console.log(`${signal}: finishing ${pending.size} background task(s)`);
  if (timer) clearTimeout(timer);
  server?.close();
  await Promise.allSettled([...pending]);
  await database.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch(err => {
  console.error('startup failed', err);
  process.exit(1);
});

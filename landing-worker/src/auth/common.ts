import type { Env } from '../types';

export class AuthError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

export const now = () => Math.floor(Date.now() / 1000);
export const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

export function appOrigin(env: Env): URL {
  let url: URL;
  try { url = new URL(env.APP_ORIGIN); } catch { throw new AuthError(503, 'ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new AuthError(503, 'ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน');
  }
  return url;
}

export function secret(env: Env): string {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new AuthError(503, 'ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน');
  return env.SESSION_SECRET;
}

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function sha256(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
export async function hmac(env: Env, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}
// Compare fixed-length digests without short-circuiting on any differing byte.
export function constantTimeEqual(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}
export function cookie(request: Request, name: string): string | null {
  const matches = (request.headers.get('Cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}
export function cookieValue(env: Env, name: string, value: string, age: number): string {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${appOrigin(env).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function readJson(request: Request, maxBytes = 2048): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AuthError(400, 'กรุณาส่งข้อมูลในรูปแบบ JSON');
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw new AuthError(413, 'ข้อมูลมีขนาดใหญ่เกินไป');
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(400, 'ข้อมูลไม่ถูกต้อง');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new AuthError(413, 'ข้อมูลมีขนาดใหญ่เกินไป'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new AuthError(400, 'ข้อมูลไม่ถูกต้อง'); }
}

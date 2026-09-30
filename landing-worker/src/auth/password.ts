import type { Env, User } from '../types';
import { signupBonusStatement, signupCredits } from '../onboarding/signup';
import { AuthError, base64url, constantTimeEqual, cookie, cookieValue, hmac, json, now, randomToken, readJson, sha256 } from './common';
import { createSession, getUser, SESSION_COOKIE, SESSION_SECONDS } from './session';
import { verifyTurnstile } from './turnstile';

// Email + password accounts. Passwords are hashed with PBKDF2-SHA256 (Web Crypto; Workers allow
// at most 100,000 iterations). There is no email verification yet, so the email is a sign-in name,
// not a proven address; a forgotten password is reset by an admin (src/admin/customers.ts).

export const PBKDF2_ITERATIONS = 100_000;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const WINDOW = 15 * 60;
const MAX_FAILS_PER_EMAIL = 5;   // per 15 minutes
const MAX_FAILS_PER_IP = 30;     // per 15 minutes
const MAX_SIGNUPS_PER_IP = 5;    // per hour
const WRONG = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';

export function normalizeEmail(input: unknown): string {
  if (typeof input !== 'string') throw new AuthError(400, 'กรุณากรอกอีเมลให้ถูกต้อง');
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, 'กรุณากรอกอีเมลให้ถูกต้อง');
  return email;
}

export function checkPassword(input: unknown): string {
  if (typeof input !== 'string' || [...input].length < MIN_PASSWORD || [...input].length > MAX_PASSWORD) {
    throw new AuthError(400, `รหัสผ่านต้องยาว ${MIN_PASSWORD}–${MAX_PASSWORD} ตัวอักษร`);
  }
  return input;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${base64url(salt)}$${base64url(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

function fromBase64url(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, rounds, salt, hash] = stored.split('$');
  const iterations = Number(rounds);
  if (scheme !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS || !salt || !hash) return false;
  return constantTimeEqual(base64url(await pbkdf2(password, fromBase64url(salt), iterations)), hash);
}

// Spent on unknown emails too, so a wrong email and a wrong password take the same time.
// Built lazily: Workers do not allow random values in global scope.
let dummyHash: Promise<string> | null = null;
const timingPadding = () => (dummyHash ??= hashPassword('naka-ai timing padding'));

async function limitKeys(request: Request, env: Env, email: string) {
  return {
    email: await hmac(env, `pw-email:${email}`),
    ip: await hmac(env, `pw-ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`),
  };
}

async function recentCount(env: Env, key: string, kind: 'login' | 'register', since: number): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_password_attempts WHERE key = ? AND kind = ? AND created_at > ?')
    .bind(key, kind, since).first<{ n: number }>();
  return row?.n ?? 0;
}

async function record(env: Env, kind: 'login' | 'register', ...keys: string[]): Promise<void> {
  const t = now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_password_attempts WHERE created_at <= ?').bind(t - 3600),
    ...keys.map(key => env.DB.prepare('INSERT INTO auth_password_attempts (key, kind, created_at) VALUES (?, ?, ?)').bind(key, kind, t)),
  ]);
}

/** Turnstile guards these forms once it is configured; until then the rate limits do. */
async function botCheck(request: Request, env: Env, token: unknown): Promise<void> {
  if (env.TURNSTILE_SECRET_KEY?.trim()) await verifyTurnstile(request, env, token);
}

function displayName(input: unknown, email: string): string {
  const name = typeof input === 'string' ? input.trim() : '';
  return name ? [...name].slice(0, 160).join('') : email.split('@')[0].slice(0, 160);
}

/** POST /api/auth/password/register { email, password, name?, turnstileToken? } */
export async function registerWithPassword(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request, 4096);
  const email = normalizeEmail(body.email);
  const password = checkPassword(body.password);
  await botCheck(request, env, body.turnstileToken);
  const keys = await limitKeys(request, env, email);
  if (await recentCount(env, keys.ip, 'register', now() - 3600) >= MAX_SIGNUPS_PER_IP) {
    throw new AuthError(429, 'สมัครบ่อยเกินไป กรุณารอสักครู่', 3600);
  }
  await record(env, 'register', keys.ip);

  const userId = crypto.randomUUID();
  const t = now();
  const hash = await hashPassword(password);
  const created = "EXISTS (SELECT 1 FROM users WHERE id = ?1)";
  // One transaction: the user, its identity and its password exist together, or not at all.
  const statements = [
    env.DB.prepare(`INSERT INTO users (id, display_name, created_at)
      SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM auth_identities WHERE provider = 'password' AND provider_uid = ?)`)
      .bind(userId, displayName(body.name, email), t, email),
    env.DB.prepare(`INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at)
      SELECT ?2, ?1, 'password', ?3, ?3, ?4 WHERE ${created}`).bind(userId, crypto.randomUUID(), email, t),
    env.DB.prepare(`INSERT INTO auth_passwords (user_id, hash, updated_at) SELECT ?1, ?2, ?3 WHERE ${created}`).bind(userId, hash, t),
  ];
  const bonus = signupCredits(env);
  if (bonus > 0) statements.push(signupBonusStatement(env.DB, userId, bonus));
  const [inserted] = await env.DB.batch(statements);
  if (inserted.meta.changes !== 1) throw new AuthError(409, 'อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ หรือติดต่อทีมงานถ้าลืมรหัสผ่าน');
  const user = await getUser(env.DB, userId);
  if (!user) throw new AuthError(403, 'บัญชีนี้ไม่สามารถเข้าสู่ระบบได้');
  return json({ user }, 201, { 'Set-Cookie': await createSession(request, env, user) });
}

/** POST /api/auth/password/login { email, password, turnstileToken? } */
export async function loginWithPassword(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request, 4096);
  const email = normalizeEmail(body.email);
  if (typeof body.password !== 'string' || !body.password || [...body.password].length > MAX_PASSWORD) throw new AuthError(400, WRONG);
  await botCheck(request, env, body.turnstileToken);
  const keys = await limitKeys(request, env, email);
  const since = now() - WINDOW;
  if (await recentCount(env, keys.email, 'login', since) >= MAX_FAILS_PER_EMAIL ||
      await recentCount(env, keys.ip, 'login', since) >= MAX_FAILS_PER_IP) {
    throw new AuthError(429, 'ลองรหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่', WINDOW);
  }
  const row = await env.DB.prepare(`SELECT i.user_id, p.hash FROM auth_identities i JOIN auth_passwords p ON p.user_id = i.user_id
    WHERE i.provider = 'password' AND i.provider_uid = ?`).bind(email).first<{ user_id: string; hash: string }>();
  const ok = await verifyPassword(body.password, row?.hash ?? await timingPadding()) && !!row;
  let user: User | null = null;
  if (ok) user = await getUser(env.DB, row!.user_id);
  if (!user) {
    await record(env, 'login', keys.email, keys.ip);
    // A disabled account gets the same answer as a wrong password.
    throw new AuthError(401, WRONG);
  }
  return json({ user }, 200, { 'Set-Cookie': await createSession(request, env, user) });
}

/** Whether a signed-in customer can use the self-service password form.
 * Older auth deployments can still serve /me before migration 0012 is applied. */
export async function hasPassword(env: Env, userId: string): Promise<boolean | undefined> {
  const table = await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_passwords'").first();
  if (!table) return undefined;
  return !!await env.DB.prepare('SELECT 1 FROM auth_passwords WHERE user_id = ?').bind(userId).first();
}

/** POST /api/auth/password/change { currentPassword, newPassword } — user is from requireUser. */
export async function changePassword(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson(request, 4096);
  const account = await env.DB.prepare(`SELECT i.provider_uid AS email, p.hash FROM auth_identities i
    JOIN auth_passwords p ON p.user_id = i.user_id WHERE i.user_id = ? AND i.provider = 'password'`)
    .bind(user.id).first<{ email: string; hash: string }>();
  if (!account) throw new AuthError(400, 'บัญชีนี้เข้าสู่ระบบด้วย Google หรือ LINE จึงไม่มีรหัสผ่าน');

  const keys = await limitKeys(request, env, account.email);
  const since = now() - WINDOW;
  const failures = await recentCount(env, keys.email, 'login', since);
  if (failures >= MAX_FAILS_PER_EMAIL || await recentCount(env, keys.ip, 'login', since) >= MAX_FAILS_PER_IP) {
    throw new AuthError(429, 'ลองรหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่', WINDOW);
  }
  const current = body.currentPassword;
  if (typeof current !== 'string' || !current || [...current].length > MAX_PASSWORD ||
      !await verifyPassword(current, account.hash)) {
    await record(env, 'login', keys.email, keys.ip);
    if (failures + 1 >= MAX_FAILS_PER_EMAIL) {
      throw new AuthError(429, 'ลองรหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่', WINDOW);
    }
    throw new AuthError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  const next = checkPassword(body.newPassword);
  if (next === current) throw new AuthError(400, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');

  const session = cookie(request, SESSION_COOKIE);
  if (!session) throw new AuthError(401, 'กรุณาเข้าสู่ระบบ');
  const token = randomToken();
  const digest = await sha256(token);
  const previousDigest = await sha256(session);
  const hash = await hashPassword(next);
  const timestamp = now();
  // A concurrent reset/change or revoked session cannot update the hash, delete sessions,
  // or issue a replacement. All three statements commit together in D1.
  const [updated] = await env.DB.batch([
    env.DB.prepare(`UPDATE auth_passwords SET hash = ?, updated_at = ? WHERE user_id = ? AND hash = ?
      AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?)`)
      .bind(hash, timestamp, user.id, account.hash, previousDigest, user.id, timestamp),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?
      AND EXISTS (SELECT 1 FROM auth_passwords WHERE user_id = ? AND hash = ?)`).bind(user.id, user.id, hash),
    env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM auth_passwords WHERE user_id = ? AND hash = ?)`)
      .bind(digest, user.id, timestamp + SESSION_SECONDS, timestamp, user.id, hash),
  ]);
  if (updated.meta.changes !== 1) throw new AuthError(409, 'ข้อมูลบัญชีเปลี่ยนไป กรุณาเข้าสู่ระบบใหม่');
  return json({ ok: true }, 200, { 'Set-Cookie': cookieValue(env, SESSION_COOKIE, token, SESSION_SECONDS) });
}

/** Admin reset: a new random password, shown once to the admin, and every session signed out. */
export function temporaryPassword(): string {
  // No look-alike characters (0/O, 1/l/I), so it can be read out over the phone.
  const alphabet = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
  const limit = 256 - (256 % alphabet.length); // rejection sampling: no modulo bias
  let out = '';
  while (out.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < limit && out.length < 12) out += alphabet[b % alphabet.length];
  }
  return out;
}

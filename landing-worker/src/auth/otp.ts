import type { Env } from '../types';
import { AuthError, constantTimeEqual, hmac, json, now, randomToken, readJson } from './common';
import { createSession, identityUser } from './session';
import { smsProvider } from './sms';

export function normalizePhone(input: unknown): string {
  if (typeof input !== 'string' || input.length > 32) throw new AuthError(400, 'กรุณากรอกเบอร์มือถือไทยให้ถูกต้อง');
  const phone = input.trim().replace(/[\s()-]/g, '');
  if (/^0[689]\d{8}$/.test(phone)) return `+66${phone.slice(1)}`;
  if (/^\+66[689]\d{8}$/.test(phone)) return phone;
  throw new AuthError(400, 'กรุณากรอกเบอร์มือถือไทยให้ถูกต้อง');
}

function generateCode(): string {
  // Rejection sampling avoids modulo bias over the million possible codes.
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= 4294000000);
  return String(value[0] % 1000000).padStart(6, '0');
}

export async function requestOtp(request: Request, env: Env): Promise<Response> {
  const phone = normalizePhone((await readJson(request)).phone);
  const provider = smsProvider(env);
  const timestamp = now();
  const ipHash = await hmac(env, `ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`);
  const challenge = randomToken();
  const code = generateCode();
  const codeHash = await hmac(env, `otp:${phone}:${challenge}:${code}`);
  // Admission and replacement happen in one transaction. Concurrent requests cannot
  // both pass the cooldown or overwrite the accepted challenge with a rejected one.
  const result = await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_otp_requests WHERE created_at <= ?').bind(timestamp - 3600),
    env.DB.prepare('DELETE FROM otp_codes WHERE expires_at <= ?').bind(timestamp),
    env.DB.prepare(`INSERT INTO auth_otp_requests (id, phone, ip_hash, created_at)
      SELECT ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM auth_otp_requests WHERE phone = ? AND created_at > ?)
      AND (SELECT COUNT(*) FROM auth_otp_requests WHERE phone = ? AND created_at > ?) < 3
      AND (SELECT COUNT(*) FROM auth_otp_requests WHERE ip_hash = ? AND created_at > ?) < 20
      RETURNING id`).bind(challenge, phone, ipHash, timestamp, phone, timestamp - 60, phone, timestamp - 3600, ipHash, timestamp - 3600),
    env.DB.prepare(`INSERT INTO otp_codes (phone, challenge_id, code_hash, expires_at, attempts, ready, created_at)
      SELECT ?, ?, ?, ?, 0, 0, ? WHERE EXISTS (SELECT 1 FROM auth_otp_requests WHERE id = ?)
      ON CONFLICT(phone) DO UPDATE SET challenge_id = excluded.challenge_id, code_hash = excluded.code_hash,
      expires_at = excluded.expires_at, attempts = 0, ready = 0, created_at = excluded.created_at`)
      .bind(phone, challenge, codeHash, timestamp + 300, timestamp, challenge),
  ]);
  if (!result[2].results.length) {
    const limits = await env.DB.prepare(`SELECT
      (SELECT MAX(created_at) FROM auth_otp_requests WHERE phone = ?) AS latest,
      (SELECT COUNT(*) FROM auth_otp_requests WHERE phone = ?) AS phone_count,
      (SELECT MIN(created_at) FROM auth_otp_requests WHERE phone = ?) AS phone_first,
      (SELECT COUNT(*) FROM auth_otp_requests WHERE ip_hash = ?) AS ip_count,
      (SELECT MIN(created_at) FROM auth_otp_requests WHERE ip_hash = ?) AS ip_first`)
      .bind(phone, phone, phone, ipHash, ipHash).first<{ latest: number | null; phone_count: number; phone_first: number; ip_count: number; ip_first: number }>();
    const retry = Math.max(1, (limits?.latest ?? timestamp - 60) + 60 - timestamp,
      limits && limits.phone_count >= 3 ? limits.phone_first + 3600 - timestamp : 0,
      limits && limits.ip_count >= 20 ? limits.ip_first + 3600 - timestamp : 0);
    throw new AuthError(429, 'ขอรหัสบ่อยเกินไป กรุณารอสักครู่', retry);
  }
  try {
    await provider.send(phone, `รหัสเข้าสู่ระบบ NAKA-AI: ${code} ใช้ได้ภายใน 5 นาที ห้ามบอกรหัสนี้แก่ผู้อื่น`);
    await env.DB.prepare('UPDATE otp_codes SET ready = 1 WHERE phone = ? AND challenge_id = ?').bind(phone, challenge).run();
  } catch (error) {
    // Keep the send reservation: uncertain provider timeouts must not allow SMS spam.
    await env.DB.prepare('DELETE FROM otp_codes WHERE phone = ? AND challenge_id = ?').bind(phone, challenge).run();
    throw error;
  }
  return json({ ok: true, retryAfter: 60 });
}

export async function verifyOtp(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const phone = normalizePhone(body.phone);
  if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) throw new AuthError(400, 'กรุณากรอกรหัส 6 หลัก');
  const timestamp = now();
  const row = await env.DB.prepare(`UPDATE otp_codes SET attempts = attempts + 1
    WHERE phone = ? AND expires_at > ? AND attempts < 5 AND ready = 1
    RETURNING challenge_id, code_hash, attempts, expires_at`)
    .bind(phone, timestamp).first<{ challenge_id: string; code_hash: string; attempts: number; expires_at: number }>();
  if (!row) {
    const locked = await env.DB.prepare('SELECT expires_at FROM otp_codes WHERE phone = ? AND attempts >= 5 AND expires_at > ?').bind(phone, timestamp).first<{ expires_at: number }>();
    if (locked) throw new AuthError(429, 'กรอกรหัสผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่', locked.expires_at - timestamp);
    throw new AuthError(400, 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสใหม่');
  }
  const digest = await hmac(env, `otp:${phone}:${row.challenge_id}:${body.code}`);
  if (!constantTimeEqual(digest, row.code_hash)) {
    if (row.attempts >= 5) throw new AuthError(429, 'กรอกรหัสผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่', row.expires_at - timestamp);
    throw new AuthError(400, 'รหัสไม่ถูกต้องหรือหมดอายุ');
  }
  // A single conditional delete claims the code. Replays, resend races, and
  // parallel verifications cannot create multiple sessions from the same code.
  const claimed = await env.DB.prepare(`DELETE FROM otp_codes
    WHERE phone = ? AND challenge_id = ? AND attempts = ? AND expires_at > ? AND ready = 1 RETURNING phone`)
    .bind(phone, row.challenge_id, row.attempts, now()).first();
  if (!claimed) throw new AuthError(400, 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาลองอีกครั้ง');
  const user = await identityUser(env, 'phone', phone, 'สมาชิก NAKA-AI');
  return json({ user }, 200, { 'Set-Cookie': await createSession(request, env, user) });
}

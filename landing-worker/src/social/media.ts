import type { Env } from '../types';
import { appOrigin, constantTimeEqual, json, now, SocialError } from './common';
import { keyBytes, mediaSignature } from './crypto';
export const MAX_UPLOAD = 50 * 1024 * 1024;
const mediaKeyPattern = /^[a-f0-9-]{36}\.(mp4|webm)$/;
export function bucket(env: Env): R2Bucket {
  if (!env.MEDIA) throw new SocialError(503, 'ระบบอัปโหลดคลิปยังไม่พร้อมใช้งาน');
  return env.MEDIA;
}
export async function upload(request: Request, env: Env, userId: string): Promise<Response> {
  const media = bucket(env);
  const type = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'video/mp4' && type !== 'video/webm') throw new SocialError(400, 'รองรับเฉพาะไฟล์ MP4 หรือ WebM');
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_UPLOAD)) throw new SocialError(413, 'คลิปต้องมีขนาดไม่เกิน 50 MB');
  if (!request.body) throw new SocialError(400, 'กรุณาเลือกไฟล์คลิป');
  // Buffer once in a bounded allocation: streaming into R2 requires a known length.
  // This also prevents partial objects and limits both chunked and dishonest uploads.
  const reader = request.body.getReader();
  const data = new Uint8Array(MAX_UPLOAD);
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_UPLOAD) { await reader.cancel(); throw new SocialError(413, 'คลิปต้องมีขนาดไม่เกิน 50 MB'); }
      data.set(chunk.value, size - chunk.value.length);
    }
  } finally { reader.releaseLock(); }
  const valid = type === 'video/mp4' ? size >= 12 && new TextDecoder().decode(data.subarray(4, 8)) === 'ftyp'
    : size >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3;
  if (!valid) throw new SocialError(400, 'รูปแบบไฟล์คลิปไม่ถูกต้อง');
  const key = `${crypto.randomUUID()}.${type === 'video/mp4' ? 'mp4' : 'webm'}`;
  await media.put(key, data.subarray(0, size), { httpMetadata: { contentType: type }, customMetadata: { userId } });
  try {
    await env.DB.prepare('INSERT INTO social_media (key, user_id, content_type, size, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(key, userId, type, size, now()).run();
  } catch (error) { await media.delete(key); throw error; }
  return json({ mediaKey: key }, 201);
}
export async function signedMediaUrl(env: Env, key: string): Promise<string> {
  const origin = appOrigin(env).origin;
  if (!mediaKeyPattern.test(key)) throw new SocialError(400, 'ไม่พบคลิป');
  const exp = now() + 3600;
  const sig = await mediaSignature(env, origin, key, exp);
  return `${origin}/api/social/media/${key}?exp=${exp}&sig=${sig}`;
}
export async function serveMedia(env: Env, url: URL, key: string): Promise<Response> {
  const media = bucket(env);
  keyBytes(env);
  const expiry = url.searchParams.get('exp') || '';
  const sig = url.searchParams.get('sig') || '';
  const exp = Number(expiry);
  if (!mediaKeyPattern.test(key) || url.searchParams.getAll('exp').length !== 1 || url.searchParams.getAll('sig').length !== 1 ||
      !/^\d{1,12}$/.test(expiry) || !Number.isSafeInteger(exp) || exp <= now() || exp > now() + 3600 || !/^[\w-]{43}$/.test(sig) ||
      !constantTimeEqual(sig, await mediaSignature(env, appOrigin(env).origin, key, exp))) throw new SocialError(403, 'ลิงก์คลิปไม่ถูกต้องหรือหมดอายุ');
  const owned = await env.DB.prepare('SELECT key FROM social_media WHERE key = ?').bind(key).first();
  const file = owned ? await media.get(key) : null;
  if (!file) throw new SocialError(404, 'ไม่พบคลิป');
  return new Response(file.body, { headers: { 'Content-Type': key.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
    'Content-Length': String(file.size), 'Content-Disposition': 'inline', 'Cache-Control': 'no-store' } });
}

import type { Env } from '../types';
import { constantTimeEqual, InboxError, json, now, readBytes, record, sha256 } from './common';
import { drainInbox } from './queue';

export async function handleMetaWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.pathname !== '/webhook/meta') return json({ error: 'ไม่พบเส้นทาง' }, 404);
    if (request.method === 'GET') {
      if (!env.META_WEBHOOK_VERIFY_TOKEN?.trim()) throw new InboxError(503, 'ระบบ webhook ยังไม่พร้อมใช้งาน');
      const token = url.searchParams.get('hub.verify_token') || '';
      const challenge = url.searchParams.get('hub.challenge') || '';
      if (['hub.mode', 'hub.verify_token', 'hub.challenge'].some(key => url.searchParams.getAll(key).length !== 1) ||
          url.searchParams.get('hub.mode') !== 'subscribe' || token.length > 1024 || !constantTimeEqual(token, env.META_WEBHOOK_VERIFY_TOKEN) ||
          !/^\d{1,100}$/.test(challenge)) throw new InboxError(403, 'ยืนยัน webhook ไม่สำเร็จ');
      return new Response(challenge, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'POST') return json({ error: 'วิธีเรียกใช้งานไม่ถูกต้อง' }, 405, { Allow: 'GET, POST' });
    if (!env.META_APP_SECRET?.trim()) throw new InboxError(503, 'ระบบ webhook ยังไม่พร้อมใช้งาน');
    const signature = request.headers.get('X-Hub-Signature-256') || '';
    if (!/^sha256=[a-f0-9]{64}$/.test(signature)) throw new InboxError(403, 'ลายเซ็น webhook ไม่ถูกต้อง');
    const bytes = await readBytes(request, 256 * 1024);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.META_APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
    if (!constantTimeEqual(signature.slice(7), Array.from(expected, b => b.toString(16).padStart(2, '0')).join('')))
      throw new InboxError(403, 'ลายเซ็น webhook ไม่ถูกต้อง');
    // Parse only after authenticating the original bytes, never reserialized JSON.
    let raw: string;
    try {
      raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
      const value: unknown = JSON.parse(raw);
      if (!record(value) || !Array.isArray(value.entry)) throw new Error();
    } catch { throw new InboxError(400, 'ข้อมูล webhook ไม่ถูกต้อง'); }
    // Acknowledge only durable storage. A database failure returns 503 so Meta can retry safely.
    await env.DB.prepare('INSERT OR IGNORE INTO inbox_webhook_receipts (id,body,created_at) VALUES (?,?,?)')
      .bind(await sha256(raw), raw, now()).run();
    ctx.waitUntil(drainInbox(env, { maxReceipts: 1, maxMessages: 5 }).catch(() => undefined));
    return json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    return json({ error: error instanceof InboxError ? error.message : 'บันทึก webhook ไม่สำเร็จ กรุณาลองใหม่' },
      error instanceof InboxError ? error.status : 503, { 'Cache-Control': 'no-store' });
  }
}

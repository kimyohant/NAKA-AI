import type { Env } from '../types';
export { appOrigin, AuthError as InboxError, constantTimeEqual, json, now, readJson, sha256 } from '../auth/common';
import { AuthError, now } from '../auth/common';
export const INBOX_JOB_KIND = 'inbox_reply';
/** Packages that include the chat bot (migrations/0004_plans.sql, pricing section). */
export const INBOX_PLANS = ['business', 'max'];
export const INBOX_PLAN_SQL = `COALESCE((SELECT plan_id FROM subscriptions WHERE user_id = m.user_id AND status = 'active'), 'free') IN ('business', 'max')`;
export interface Settings { mode: 'off' | 'draft' | 'auto'; tone: string; escalate_keywords: string; revision: number; }
export interface Message {
  id: string; thread_id: string; user_id: string; body: string; draft: string | null;
  status: string; direction: string; reply_target: string; message_at: number; confidence: string | null;
  handoff_reason: string | null; queue_token: string | null; job_id: string | null;
  draft_lock: string | null; send_phase: string; reply_external_id: string | null;
  thread_revision: number | null; settings_revision: number | null;
}
export interface Thread {
  id: string; user_id: string; social_account_id: string; kind: 'comment' | 'dm'; external_thread_id: string;
  status: string; auto_paused: number; revision: number; last_customer_at: number; last_inbound_id: string | null;
}
export const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export const remoteId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_:.+\/=\-]{1,256}$/.test(v);
export const commentId = (v: unknown): v is string => typeof v === 'string' && /^\d[\d_]{0,149}$/.test(v);
export const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
export async function settings(env: Env, userId: string): Promise<Settings> {
  return await env.DB.prepare('SELECT mode,tone,escalate_keywords,revision FROM inbox_settings WHERE user_id = ?').bind(userId).first<Settings>()
    ?? { mode: 'off', tone: 'สุภาพ เป็นกันเอง', escalate_keywords: '[]', revision: 0 };
}
export async function pauseThread(env: Env, threadId: string, userId: string): Promise<void> {
  await env.DB.prepare("UPDATE inbox_threads SET status='needs_human',auto_paused=1,revision=revision+1 WHERE id=? AND user_id=?")
    .bind(threadId, userId).run();
}
export const externalKey = (platform: string, account: string, kind: string, id: string) => `${platform}:${account}:${kind}:${id}`;
export async function readBytes(request: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get('Content-Length') || 0) > max) throw new AuthError(413, 'ข้อมูลมีขนาดใหญ่เกินไป');
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(400, 'ข้อมูลไม่ถูกต้อง');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > max) { await reader.cancel(); throw new AuthError(413, 'ข้อมูลมีขนาดใหญ่เกินไป'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function markHandoff(env: Env, message: Message, reason: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE inbox_messages SET handoff_reason=?,status=CASE WHEN status='pending' THEN 'drafted' ELSE status END,confidence='low' WHERE id=? AND user_id=? AND send_phase='ready'")
      .bind(reason, message.id, message.user_id),
    env.DB.prepare("UPDATE inbox_threads SET status='needs_human',auto_paused=1,revision=revision+1 WHERE id=? AND user_id=?")
      .bind(message.thread_id, message.user_id),
  ]);
}

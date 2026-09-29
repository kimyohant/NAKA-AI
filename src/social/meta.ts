import type { Env } from '../types';
import { externalId, SocialError } from './common';
import { keyBytes } from './crypto';

// Meta's official SDK and Postman contracts, checked 2026-09-29; see integration doc.
export const GRAPH_VERSION = 'v26.0';
export const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish',
  // AI inbox (src/inbox): page webhook subscription, replying to comments and messages.
  // Confirm the current names in Meta's permission reference before App Review.
  'pages_manage_metadata', 'pages_manage_engagement', 'pages_messaging', 'instagram_manage_comments', 'instagram_manage_messages'];
/** Page webhook fields the AI inbox listens to (src/inbox/events.ts). */
export const PAGE_WEBHOOK_FIELDS = 'feed,messages';
export function metaConfig(env: Env): { id: string; secret: string } {
  keyBytes(env);
  if (!env.META_APP_ID || !/^\d+$/.test(env.META_APP_ID) || !env.META_APP_SECRET?.trim())
    throw new SocialError(503, 'ระบบเชื่อมต่อ Meta ยังไม่พร้อมใช้งาน');
  return { id: env.META_APP_ID, secret: env.META_APP_SECRET };
}
export class MetaError extends Error {
  constructor(public detail: string, public retryable = false, public revoked = false, public rateLimitRejected = false) { super('Meta request failed'); }
}
export async function graph(path: string, token: string | null, fields: Record<string, string> = {}, method = 'GET', video = false): Promise<Record<string, any>> {
  const url = new URL(`https://${video ? 'graph-video' : 'graph'}.facebook.com/${GRAPH_VERSION}/${path}`);
  const params = new URLSearchParams(fields);
  if (method === 'GET') url.search = params.toString();
  let response: Response;
  try {
    response = await fetch(url.toString(), { method, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(method === 'POST' ? { body: params } : {}) });
  } catch { throw new MetaError('network_or_timeout', true); }
  let data: Record<string, any>;
  try { data = await response.json() as Record<string, any>; if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); }
  catch { throw new MetaError(`invalid_response_http_${response.status}`, response.status >= 500); }
  if (!response.ok || data.error) {
    const code = Number.isSafeInteger(data.error?.code) ? data.error.code : 0;
    const subcode = Number.isSafeInteger(data.error?.error_subcode) ? data.error.error_subcode : 0;
    // Deliberately discard all messages, URLs, tokens and arbitrary upstream text.
    throw new MetaError(`http_${response.status}_code_${code}_subcode_${subcode}`,
      response.status === 429 || response.status >= 500 || data.error?.is_transient === true || [4, 17, 32, 613].includes(code), code === 190,
      [400, 429].includes(response.status) && [4, 17, 32, 613].includes(code));
  }
  return data;
}
export function remoteId(data: Record<string, any>): string {
  if (!externalId(data.id)) throw new MetaError('missing_remote_id');
  return data.id;
}

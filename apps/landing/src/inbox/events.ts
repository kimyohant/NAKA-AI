import type { Env } from '../types';
import type { Account } from '../social/common';
import { commentId, externalKey, now, record, remoteId } from './common';

interface Event {
  platform: 'facebook' | 'instagram'; account: string; kind: 'comment' | 'dm'; id: string;
  thread: string; target: string; sender: string; name: string; body: string;
  time: number; media: string | null; own: boolean; appId: string | null;
}
function timestamp(value: unknown, milliseconds = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return 0;
  const seconds = milliseconds ? Math.floor(value / 1000) : value;
  return seconds > now() + 60 ? 0 : Math.min(seconds, now());
}
// Payloads checked against Meta Page/Instagram Webhooks reference; unsupported events are ignored.
export function normalizeEvents(payload: unknown): Event[] {
  if (!record(payload) || !['page', 'instagram'].includes(payload.object) || !Array.isArray(payload.entry)) return [];
  const platform = payload.object === 'page' ? 'facebook' : 'instagram';
  const events: Event[] = [];
  for (const entry of payload.entry) {
    if (!record(entry) || !remoteId(entry.id)) continue;
    const dm = (value: unknown) => {
      if (!record(value) || !record(value.message) || !remoteId(value.message.mid) || !remoteId(value.sender?.id) || !remoteId(value.recipient?.id)) return;
      const own = value.sender.id === entry.id || value.message.is_echo === true || value.is_self === true || value.message.is_self === true;
      // Reject events addressed to a different account, including ambiguous own-message flags.
      if (own ? value.sender.id !== entry.id : value.recipient.id !== entry.id) return;
      if (value.message.is_deleted || value.message.is_unsupported) return;
      const customer = own ? value.recipient.id : value.sender.id;
      events.push({ platform, account: entry.id, kind: 'dm', id: value.message.mid, thread: customer, target: customer,
        sender: value.sender.id, name: '', body: typeof value.message.text === 'string' ? value.message.text.slice(0, 8000) : '',
        time: timestamp(value.timestamp, true), media: null, own, appId: remoteId(value.message.app_id) ? value.message.app_id : null });
    };
    if (Array.isArray(entry.messaging)) for (const value of entry.messaging) dm(value);
    if (!Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!record(change) || !record(change.value)) continue;
      const v = change.value;
      if (change.field === 'messages' || change.field === 'message_echoes') { dm(v); continue; }
      const fb = platform === 'facebook' && change.field === 'feed' && v.item === 'comment' && v.verb === 'add';
      const ig = platform === 'instagram' && change.field === 'comments';
      if (!fb && !ig) continue;
      const id = fb ? v.comment_id : v.id;
      const media = fb ? v.post_id : v.media?.id;
      if (!commentId(id) || !remoteId(v.from?.id) || !commentId(media)) continue;
      const parent = commentId(v.parent_id) && v.parent_id !== media ? v.parent_id : id;
      const body = fb ? v.message : v.text;
      events.push({ platform, account: entry.id, kind: 'comment', id, thread: parent, target: id, sender: v.from.id,
        name: String(v.from.name ?? v.from.username ?? '').slice(0, 200), body: typeof body === 'string' ? body.slice(0, 8000) : '',
        time: timestamp(fb ? v.created_time : entry.time), media, own: v.from.id === entry.id || v.from.self_ig_scoped_id === entry.id, appId: null });
    }
  }
  return events;
}

async function storeEvent(env: Env, event: Event): Promise<string | null> {
  const accounts = await env.DB.prepare(`SELECT a.* FROM social_accounts a JOIN users u ON u.id=a.user_id
    WHERE a.platform=? AND a.external_id=? AND a.status='active' AND u.status='active'
    AND (a.token_expires_at IS NULL OR a.token_expires_at>?) LIMIT 2`).bind(event.platform, event.account, now()).all<Account>();
  // Same Page linked by two tenants has no unambiguous inbox owner. Never disclose to both.
  if (accounts.results.length !== 1) return accounts.results.length ? 'ambiguous_account' : 'account_unavailable';
  const account = accounts.results[0];
  const key = externalKey(event.platform, event.account, event.kind, event.id);
  if (await env.DB.prepare('SELECT id FROM inbox_messages WHERE external_id=?').bind(key).first()) return null;
  const ours = event.own && (event.appId === env.META_APP_ID || !!await env.DB.prepare('SELECT id FROM inbox_messages WHERE user_id=? AND reply_external_id=?').bind(account.user_id, key).first());
  // Comment echoes from native tools pause all threads on that post if the parent cannot be resolved.
  if (event.own && !ours) await env.DB.prepare(`UPDATE inbox_threads SET status='needs_human',auto_paused=1,revision=revision+1
    WHERE social_account_id=? AND kind=? AND (external_thread_id=? OR (?='comment' AND media_id=?))`)
    .bind(account.id, event.kind, event.thread, event.kind, event.media).run();
  const id = crypto.randomUUID(); const threadId = crypto.randomUUID();
  const direction = event.own ? 'out' : 'in';
  const state = event.own ? 'sent' : 'pending';
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO inbox_threads
      (id,user_id,social_account_id,kind,external_thread_id,customer_name,status,last_message_at,media_id,auto_paused)
      VALUES (?,?,?,?,?,?,?, ?,?,?)`).bind(threadId, account.user_id, account.id, event.kind, event.thread, event.name,
        event.own && !ours ? 'needs_human' : 'open', event.time || now(), event.media, event.own && !ours ? 1 : 0),
    env.DB.prepare(`INSERT OR IGNORE INTO inbox_messages
      (id,thread_id,user_id,direction,external_id,body,status,created_at,message_at,reply_target,sent_at)
      SELECT ?,id,?,?, ?,?,?, ?,?,?,? FROM inbox_threads WHERE social_account_id=? AND kind=? AND external_thread_id=?`)
      .bind(id, account.user_id, direction, key, event.body, state, now(), event.time, event.target, event.own ? event.time || now() : null,
        account.id, event.kind, event.thread),
    env.DB.prepare(`UPDATE inbox_threads SET last_message_at=GREATEST(last_message_at,?),revision=revision+1,
      last_inbound_id=CASE WHEN ?='in' AND ?>=last_customer_at THEN ? ELSE last_inbound_id END,
      last_customer_at=CASE WHEN ?='in' THEN GREATEST(last_customer_at,?) ELSE last_customer_at END
      WHERE id=(SELECT thread_id FROM inbox_messages WHERE id=?)`).bind(event.time || now(), direction, event.time, id, direction, event.time, id),
  ]);
  return null;
}

export async function processReceipts(env: Env, maxReceipts = 5): Promise<number> {
  let processed = 0;
  for (let i = 0; i < maxReceipts; i++) {
    const lease = crypto.randomUUID();
    const row = await env.DB.prepare(`UPDATE inbox_webhook_receipts SET lease_id=?,lease_until=? WHERE id=(
      SELECT id FROM inbox_webhook_receipts WHERE status='pending' AND (lease_until IS NULL OR lease_until<=?) ORDER BY created_at,id LIMIT 1)
      AND status='pending' AND (lease_until IS NULL OR lease_until<=?) RETURNING id,body,cursor`)
      .bind(lease, now() + 60, now(), now()).first<{ id: string; body: string; cursor: number }>();
    if (!row) break;
    try {
      const events = normalizeEvents(JSON.parse(row.body));
      const end = Math.min(events.length, row.cursor + 20);
      for (let cursor = row.cursor; cursor < end; cursor++) {
        const skipped = await storeEvent(env, events[cursor]);
        const updated = await env.DB.prepare(`UPDATE inbox_webhook_receipts SET cursor=?,skipped=skipped+?,error=COALESCE(?,error)
          WHERE id=? AND lease_id=? RETURNING id`).bind(cursor + 1, skipped ? 1 : 0, skipped, row.id, lease).first();
        if (!updated) break;
      }
      await env.DB.prepare(`UPDATE inbox_webhook_receipts SET status=?,body=CASE WHEN ?=1 THEN '' ELSE body END,
        lease_id=NULL,lease_until=NULL,error=CASE WHEN ?=1 THEN 'unsupported_event' ELSE error END WHERE id=? AND lease_id=?`)
        .bind(end === events.length ? 'done' : 'pending', end === events.length ? 1 : 0, events.length === 0 ? 1 : 0, row.id, lease).run();
      processed++;
    } catch {
      await env.DB.prepare("UPDATE inbox_webhook_receipts SET error='storage_retry',lease_id=NULL,lease_until=? WHERE id=? AND lease_id=?")
        .bind(now() + 60, row.id, lease).run();
    }
  }
  return processed;
}

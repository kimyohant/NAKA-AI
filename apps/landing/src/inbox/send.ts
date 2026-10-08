import type { Env } from '../types';
import type { Account } from '../social/common';
import { decryptToken, tokenContext } from '../social/crypto';
import { graph } from '../social/meta';
import { externalKey, InboxError, type Message, now, remoteId, type Thread, settings, commentId } from './common';
import { publicSafe, validReply } from './policy';

export async function sendReply(env: Env, messageId: string, userId: string, approval: { reply?: unknown } | null): Promise<{ status: string }> {
  const message = await env.DB.prepare('SELECT * FROM inbox_messages WHERE id=? AND user_id=? AND direction=\'in\'').bind(messageId, userId).first<Message>();
  if (!message) throw new InboxError(404, 'ไม่พบข้อความ');
  if (message.status === 'sent') return { status: 'sent' }; // Repeated approvals are harmless.
  if (message.status !== 'drafted' || message.send_phase !== 'ready') throw new InboxError(409, 'ข้อความนี้ยังไม่พร้อมส่งหรือส่งไปแล้ว กรุณาตรวจสอบบทสนทนา');
  const thread = await env.DB.prepare('SELECT * FROM inbox_threads WHERE id=? AND user_id=?').bind(message.thread_id, userId).first<Thread>();
  if (!thread || thread.status === 'closed') throw new InboxError(409, 'บทสนทนานี้ปิดแล้ว');
  const account = await env.DB.prepare(`SELECT a.* FROM social_accounts a JOIN users u ON u.id=a.user_id
    WHERE a.id=? AND a.user_id=? AND a.status='active' AND u.status='active'
    AND (a.token_expires_at IS NULL OR a.token_expires_at>?)`).bind(thread.social_account_id, userId, now()).first<Account>();
  if (!account) throw new InboxError(409, 'กรุณาเชื่อมต่อบัญชีโซเชียลใหม่');
  const reply = approval?.reply === undefined ? message.draft : approval.reply;
  if (!validReply(reply)) throw new InboxError(400, 'กรุณาระบุคำตอบไม่เกิน 1,000 ไบต์');
  if (thread.kind === 'comment' && !publicSafe(reply)) throw new InboxError(400, 'คอมเมนต์สาธารณะห้ามมีข้อมูลส่วนตัว กรุณาชวนลูกค้าไปคุยในแชท');
  if (thread.kind === 'dm' && (thread.last_customer_at <= now() - 86400 || thread.last_customer_at > now()))
    throw new InboxError(409, 'พ้นช่วงตอบแชท 24 ชั่วโมงแล้ว กรุณารอข้อความใหม่จากลูกค้า');
  if (thread.kind === 'comment' && !commentId(message.reply_target)) throw new InboxError(409, 'ไม่พบคอมเมนต์ที่ต้องการตอบ');
  const config = await settings(env, userId);
  if (!approval && (config.mode !== 'auto' || config.revision !== message.settings_revision || thread.status !== 'open' || thread.auto_paused ||
      thread.revision !== message.thread_revision || thread.last_inbound_id !== message.id || message.confidence !== 'high' || message.handoff_reason))
    return { status: 'drafted' };
  const token = await decryptToken(env, account.token_enc, tokenContext(userId, account.platform, account.external_id));
  // Recheck current state atomically at the irreversible boundary. No automatic retry after this claim.
  const claimed = await env.DB.prepare(`UPDATE inbox_messages SET send_phase='sending',send_started_at=?,draft=?,approved_by=?
    WHERE id=? AND user_id=? AND status='drafted' AND send_phase='ready'
    AND EXISTS(SELECT 1 FROM social_accounts WHERE id=? AND status='active' AND token_enc=?)
    AND EXISTS(SELECT 1 FROM inbox_threads t WHERE t.id=inbox_messages.thread_id AND t.status!='closed'
      AND (t.kind!='dm' OR (t.last_customer_at>? AND t.last_customer_at<=?))
      AND (?=1 OR (t.status='open' AND t.auto_paused=0 AND t.revision=? AND t.last_inbound_id=inbox_messages.id)))
    AND (?=1 OR EXISTS(SELECT 1 FROM inbox_settings s WHERE s.user_id=inbox_messages.user_id AND s.mode='auto' AND s.revision=?)) RETURNING id`)
    .bind(now(), reply.trim(), approval ? userId : null, messageId, userId, account.id, account.token_enc, now() - 86400, now(),
      approval ? 1 : 0, message.thread_revision, approval ? 1 : 0, message.settings_revision).first();
  if (!claimed) return { status: 'drafted' };
  if (approval) await env.DB.prepare("UPDATE inbox_threads SET auto_paused=1,status='needs_human',revision=revision+1 WHERE id=? AND user_id=?").bind(thread.id, userId).run();
  try {
    const result = thread.kind === 'comment'
      ? await graph(`${message.reply_target}/${account.platform === 'facebook' ? 'comments' : 'replies'}`, token, { message: reply.trim() }, 'POST')
      : await graph('me/messages', token, { recipient: JSON.stringify({ id: message.reply_target }), message: JSON.stringify({ text: reply.trim() }),
          ...(account.platform === 'facebook' ? { messaging_type: 'RESPONSE' } : {}) }, 'POST');
    const id = thread.kind === 'dm' ? result.message_id : result.id;
    if (!remoteId(id) || (thread.kind === 'dm' && result.recipient_id !== message.reply_target)) throw new Error();
    const key = externalKey(account.platform, account.external_id, thread.kind, id);
    await env.DB.batch([
      env.DB.prepare("UPDATE inbox_messages SET status='sent',send_phase='sent',sent_at=?,reply_external_id=?,error=NULL WHERE id=? AND send_phase='sending'")
        .bind(now(), key, message.id),
      env.DB.prepare(`INSERT OR IGNORE INTO inbox_messages
        (id,thread_id,user_id,direction,external_id,body,status,sent_at,created_at,message_at,reply_target,send_phase)
        VALUES (?,?,?,'out',?,?,'sent',?,?,?,?,'sent')`).bind(crypto.randomUUID(), thread.id, userId, key, reply.trim(), now(), now(), now(), message.reply_target),
      env.DB.prepare('UPDATE inbox_threads SET last_message_at=GREATEST(last_message_at,?) WHERE id=? AND user_id=?').bind(now(), thread.id, userId),
    ]);
    return { status: 'sent' };
  } catch {
    await env.DB.batch([
      env.DB.prepare("UPDATE inbox_messages SET status='failed',send_phase='uncertain',error='send_outcome_unknown' WHERE id=? AND send_phase='sending'").bind(message.id),
      env.DB.prepare("UPDATE inbox_threads SET status='needs_human',auto_paused=1,revision=revision+1 WHERE id=? AND user_id=?").bind(thread.id, userId),
    ]);
    throw new InboxError(502, 'ยังยืนยันผลการส่งไม่ได้ กรุณาตรวจสอบบทสนทนาบน Meta ก่อนส่งใหม่');
  }
}

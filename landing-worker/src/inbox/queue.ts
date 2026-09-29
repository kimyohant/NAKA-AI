import type { Env } from '../types';
import { enqueueJob } from '../jobs';
import { INBOX_JOB_KIND, INBOX_PLAN_SQL, now } from './common';
import { processReceipts } from './events';

// Queue admission is leased separately because enqueueJob and the inbox row cannot share a transaction.
// The enqueue token travels in job.input; a delayed/orphan job cannot process a newer reservation.
export async function enqueuePending(env: Env, maxMessages = 20): Promise<number> {
  let enqueued = 0;
  await env.DB.batch([
    env.DB.prepare(`UPDATE inbox_messages SET status='failed',error='send_outcome_unknown',send_phase='uncertain'
      WHERE send_phase='sending' AND send_started_at<=?`).bind(now() - 120),
    env.DB.prepare(`UPDATE inbox_threads SET status='needs_human',auto_paused=1 WHERE id IN
      (SELECT thread_id FROM inbox_messages WHERE send_phase='uncertain')`),
    // Adopt an orphan job left between enqueueJob success and storing job_id.
    env.DB.prepare(`UPDATE inbox_messages SET job_id=(SELECT j.id FROM jobs j WHERE j.kind=? AND j.user_id=inbox_messages.user_id
      AND json_extract(j.input,'$.messageId')=inbox_messages.id AND json_extract(j.input,'$.enqueueToken')=inbox_messages.queue_token
      ORDER BY j.created_at,j.id LIMIT 1) WHERE status='pending' AND job_id IS NULL AND queue_token IS NOT NULL`).bind(INBOX_JOB_KIND),
    env.DB.prepare(`UPDATE inbox_messages SET status='failed',error='draft_job_failed',handoff_reason='draft_unavailable',confidence='low'
      WHERE status='pending' AND EXISTS(SELECT 1 FROM jobs WHERE jobs.id=inbox_messages.job_id AND jobs.status IN ('failed','done'))`),
    env.DB.prepare(`UPDATE inbox_threads SET status='needs_human',auto_paused=1 WHERE id IN
      (SELECT thread_id FROM inbox_messages WHERE error='draft_job_failed')`),
  ]);
  // Snapshot candidates: don't spin on one user's full queue and starve other shops in this invocation.
  const candidates = await env.DB.prepare(`SELECT m.id FROM inbox_messages m
    JOIN inbox_settings s ON s.user_id=m.user_id JOIN inbox_threads t ON t.id=m.thread_id
    JOIN social_accounts a ON a.id=t.social_account_id JOIN users u ON u.id=m.user_id
    WHERE m.direction='in' AND m.status='pending' AND m.job_id IS NULL AND m.send_phase='ready'
    AND (m.queue_until IS NULL OR m.queue_until<=?) AND s.mode!='off' AND a.status='active' AND u.status='active'
    AND (a.token_expires_at IS NULL OR a.token_expires_at>?) AND ${INBOX_PLAN_SQL} ORDER BY m.created_at,m.id LIMIT ?`)
    .bind(now(), now(), maxMessages).all<{ id: string }>();
  for (const candidate of candidates.results) {
    const token = crypto.randomUUID();
    const claimed = await env.DB.prepare(`UPDATE inbox_messages SET queue_token=?,queue_until=? WHERE id=? AND status='pending'
      AND job_id IS NULL AND (queue_until IS NULL OR queue_until<=?) RETURNING user_id`)
      .bind(token, now() + 60, candidate.id, now()).first<{ user_id: string }>();
    if (!claimed) continue;
    try {
      const result = await enqueueJob(env.DB, { userId: claimed.user_id, kind: INBOX_JOB_KIND, costCredits: 0,
        input: { messageId: candidate.id, enqueueToken: token }, maxAttempts: 3, countsTowardLimit: false });
      if (result.ok) {
        await env.DB.prepare('UPDATE inbox_messages SET job_id=? WHERE id=? AND queue_token=? AND job_id IS NULL')
          .bind(result.jobId, candidate.id, token).run();
        enqueued++;
      } else {
        await env.DB.prepare("UPDATE inbox_messages SET queue_token=NULL,queue_until=?,error='queue_capacity' WHERE id=? AND queue_token=?")
          .bind(now() + 30, candidate.id, token).run();
      }
    } catch {
      // Keep token to recover an enqueue whose commit succeeded but response/next write was lost.
      await env.DB.prepare("UPDATE inbox_messages SET error='enqueue_retry' WHERE id=? AND queue_token=?")
        .bind(candidate.id, token).run();
    }
  }
  return enqueued;
}

/** Call every minute alongside runQueue, and after webhook durable receipt. Does not call an LLM. */
export async function drainInbox(env: Env, { maxReceipts = 5, maxMessages = 20 } = {}): Promise<{ receipts: number; enqueued: number }> {
  if (!Number.isSafeInteger(maxReceipts) || maxReceipts < 0 || maxReceipts > 20 ||
      !Number.isSafeInteger(maxMessages) || maxMessages < 0 || maxMessages > 100) throw new RangeError('Invalid inbox drain limits');
  return { receipts: await processReceipts(env, maxReceipts), enqueued: await enqueuePending(env, maxMessages) };
}

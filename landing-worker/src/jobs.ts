import { PLAN_ID_SQL } from "./credits";

// The AI job queue lives in D1 (migrations/0002_credits_jobs.sql).
// A job's credits are held when it is enqueued and refunded exactly once if it fails for good.

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  user_id: string;
  kind: string;
  status: JobStatus;
  priority: number;
  input: string;
  output: string | null;
  cost_credits: number;
  provider_cost_usd: number | null;
  attempts: number;
  max_attempts: number;
  run_after: string;
  lease_until: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface EnqueueInput {
  userId: string;
  kind: string;
  input: unknown;
  costCredits: number;
  priority?: number;
  maxAttempts?: number;
  /** false for background work (inbox replies) that must not use the plan's parallel slots. Default true. */
  countsTowardLimit?: boolean;
}

export type EnqueueResult =
  | { ok: true; jobId: string }
  | { ok: false; reason: "insufficient_credits" | "too_many_jobs" };

/** Thrown by a handler when retrying cannot help (bad input, refused content). */
export class PermanentJobError extends Error {}

export type JobHandler = (job: Job) => Promise<{ output: unknown; providerCostUsd?: number }>;

const MAX_ERROR_LENGTH = 500;
const BASE_RETRY_SECONDS = 30;
const MAX_RETRY_SECONDS = 900;

/**
 * Hold the credits and create the job in one batch. The hold is written only when the
 * balance covers the cost and the user is under their plan's parallel-job limit;
 * the job row is written only when its hold exists, so the two never disagree.
 */
export async function enqueueJob(db: D1Database, req: EnqueueInput): Promise<EnqueueResult> {
  if (!req.userId || !req.kind) throw new RangeError("userId and kind are required");
  if (!Number.isInteger(req.costCredits) || req.costCredits < 0) throw new RangeError("costCredits must be a non-negative integer");
  const jobId = crypto.randomUUID();
  const limited = req.countsTowardLimit === false ? 0 : 1;
  const [hold] = await db.batch([
    db
      .prepare(
        `INSERT INTO credit_ledger (user_id, delta, reason, job_id)
         SELECT ?1, -?2, 'job_hold', ?3
         WHERE (SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE user_id = ?1) >= ?2
           AND (?4 = 0 OR (SELECT COUNT(*) FROM jobs WHERE user_id = ?1 AND status IN ('queued', 'running') AND counts_toward_limit = 1)
               < (SELECT max_parallel_jobs FROM plans WHERE id = ${PLAN_ID_SQL}))`,
      )
      .bind(req.userId, req.costCredits, jobId, limited),
    db
      .prepare(
        `INSERT INTO jobs (id, user_id, kind, priority, input, cost_credits, max_attempts, counts_toward_limit)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
         WHERE EXISTS (SELECT 1 FROM credit_ledger WHERE job_id = ?1 AND reason = 'job_hold')`,
      )
      .bind(jobId, req.userId, req.kind, req.priority ?? 0, JSON.stringify(req.input ?? {}), req.costCredits, req.maxAttempts ?? 3, limited),
  ]);
  if (hold.meta.changes === 1) return { ok: true, jobId };

  const balance = await db
    .prepare("SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE user_id = ?")
    .bind(req.userId)
    .first<{ balance: number }>();
  return { ok: false, reason: (balance?.balance ?? 0) < req.costCredits ? "insufficient_credits" : "too_many_jobs" };
}

/** Atomically move the next runnable job to 'running' with a lease. Null when the queue is empty. */
export async function claimNextJob(db: D1Database, leaseSeconds = 300): Promise<Job | null> {
  return db
    .prepare(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1,
         lease_until = datetime('now', ?1), updated_at = datetime('now')
       WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= datetime('now')
                   ORDER BY priority DESC, created_at, id LIMIT 1)
         AND status = 'queued'
       RETURNING *`,
    )
    .bind(`+${leaseSeconds} seconds`)
    .first<Job>();
}

export async function completeJob(db: D1Database, jobId: string, output: unknown, providerCostUsd?: number): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs SET status = 'done', output = ?, provider_cost_usd = ?, lease_until = NULL, error = NULL,
         updated_at = datetime('now'), finished_at = datetime('now')
       WHERE id = ? AND status = 'running'`,
    )
    .bind(JSON.stringify(output ?? null), providerCostUsd ?? null, jobId)
    .run();
}

/**
 * Record a failed attempt. A retryable failure with attempts left goes back to the queue
 * with exponential backoff; otherwise the job fails and its hold is refunded.
 */
export async function failJob(db: D1Database, jobId: string, error: string, retryable = true): Promise<JobStatus | null> {
  const message = error.slice(0, MAX_ERROR_LENGTH);
  const [retried] = await db.batch([
    db
      .prepare(
        `UPDATE jobs SET status = 'queued', lease_until = NULL, error = ?1, updated_at = datetime('now'),
           run_after = datetime('now', '+' || MIN(?2 * (1 << (attempts - 1)), ?3) || ' seconds')
         WHERE id = ?4 AND status = 'running' AND ?5 AND attempts < max_attempts`,
      )
      .bind(message, BASE_RETRY_SECONDS, MAX_RETRY_SECONDS, jobId, retryable ? 1 : 0),
    db
      .prepare(
        `UPDATE jobs SET status = 'failed', lease_until = NULL, error = ?1,
           updated_at = datetime('now'), finished_at = datetime('now')
         WHERE id = ?2 AND status = 'running'`,
      )
      .bind(message, jobId),
    refundStatement(db, jobId),
  ]);
  if (retried.meta.changes === 1) return "queued";
  const row = await db.prepare("SELECT status FROM jobs WHERE id = ?").bind(jobId).first<{ status: JobStatus }>();
  return row?.status ?? null;
}

/** Jobs whose worker died mid-run: count the lost attempt and retry or fail them. */
export async function recoverExpiredLeases(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare("SELECT id FROM jobs WHERE status = 'running' AND lease_until < datetime('now')")
    .all<{ id: string }>();
  for (const { id } of results) await failJob(db, id, "worker lease expired");
  return results.length;
}

/**
 * Run up to maxJobs queued jobs with the handler registered for each job's kind,
 * `concurrency` at a time. Claiming is atomic, so parallel runners never share a job.
 */
export async function runQueue(
  db: D1Database,
  handlers: Record<string, JobHandler>,
  { maxJobs = 5, leaseSeconds = 300, concurrency = 1 } = {},
): Promise<{ ran: number; recovered: number }> {
  const recovered = await recoverExpiredLeases(db);
  let ran = 0;
  const runner = async () => {
    while (ran < maxJobs) {
      ran++; // reserve a slot before the await so parallel runners stay under maxJobs
      const job = await claimNextJob(db, leaseSeconds);
      if (!job) {
        ran--;
        return;
      }
      await runJob(db, handlers, job);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, runner));
  return { ran, recovered };
}

async function runJob(db: D1Database, handlers: Record<string, JobHandler>, job: Job): Promise<void> {
  const handler = Object.hasOwn(handlers, job.kind) ? handlers[job.kind] : undefined;
  if (!handler) {
    await failJob(db, job.id, `no handler for kind '${job.kind}'`, false);
    return;
  }
  try {
    const { output, providerCostUsd } = await handler(job);
    await completeJob(db, job.id, output, providerCostUsd);
  } catch (err) {
    console.error("job failed", job.id, job.kind, err);
    await failJob(db, job.id, err instanceof Error ? err.message : String(err), !(err instanceof PermanentJobError));
  }
}

/** A user's own job plus how many runnable jobs are ahead of it. Null if it is not theirs. */
export async function getJobForUser(db: D1Database, jobId: string, userId: string) {
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").bind(jobId, userId).first<Job>();
  if (!job) return null;
  let ahead = 0;
  if (job.status === "queued") {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS ahead FROM jobs
         WHERE status = 'queued' AND id != ?1
           AND (priority > ?2 OR (priority = ?2 AND (created_at < ?3 OR (created_at = ?3 AND id < ?1))))`,
      )
      .bind(job.id, job.priority, job.created_at)
      .first<{ ahead: number }>();
    ahead = row?.ahead ?? 0;
  }
  return { job, ahead };
}

function refundStatement(db: D1Database, jobId: string) {
  // The unique (job_id, reason) index makes a second refund a no-op.
  return db
    .prepare(
      `INSERT OR IGNORE INTO credit_ledger (user_id, delta, reason, job_id)
       SELECT user_id, cost_credits, 'job_refund', id FROM jobs WHERE id = ? AND status = 'failed'`,
    )
    .bind(jobId);
}

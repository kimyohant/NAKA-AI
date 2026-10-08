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

/**
 * Thrown by a handler whose work is still running elsewhere (an AI video at the provider):
 * the job goes back to the queue for another look in `seconds`, keeping its credit hold.
 * The handler bounds the total wait itself.
 */
export class JobDeferredError extends Error {
  constructor(readonly seconds: number) { super("deferred"); }
}

/**
 * Class-level description of an error for logs and stored job errors: the error's name plus
 * an HTTP status when the provider supplies one, never the message — provider messages can
 * echo customer content. PermanentJobError keeps its message because handlers throw it with
 * fixed, content-free reason codes (e.g. 'script refused', 'tts 403').
 */
export function errorSummary(err: unknown): string {
  if (err instanceof PermanentJobError) return err.message.slice(0, MAX_ERROR_LENGTH);
  const status = (err as { status?: unknown } | null)?.status;
  const name = err instanceof Error ? err.name : typeof err;
  return typeof status === "number" && Number.isFinite(status) ? `${name} (status ${status})` : name;
}

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

/** Atomically move the next runnable job to 'running' with a lease. Null when the queue is empty.
 * The returned `attempts` is the worker's fencing token — pass it back to completeJob/failJob. */
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

/**
 * Mark the job done — only if this worker still owns the attempt. `expectedAttempts` is the
 * fencing token from claimNextJob; a worker that overstayed its lease and lost the job to
 * recovery is fenced out and returns false without writing anything.
 */
export async function completeJob(db: D1Database, jobId: string, expectedAttempts: number, output: unknown, providerCostUsd?: number): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE jobs SET status = 'done', output = ?, provider_cost_usd = ?, lease_until = NULL, error = NULL,
         updated_at = datetime('now'), finished_at = datetime('now')
       WHERE id = ? AND status = 'running' AND attempts = ?`,
    )
    .bind(JSON.stringify(output ?? null), providerCostUsd ?? null, jobId, expectedAttempts)
    .run();
  return result.meta.changes === 1;
}

/**
 * Record a failed attempt — only if this worker still owns it (`expectedAttempts` fences out
 * workers whose lease was taken over). A retryable failure with attempts left goes back to the
 * queue with exponential backoff; otherwise the job fails and its hold is refunded exactly once.
 */
export async function failJob(db: D1Database, jobId: string, expectedAttempts: number, error: string, retryable = true): Promise<JobStatus | null> {
  const message = error.slice(0, MAX_ERROR_LENGTH);
  const [retried] = await db.batch([
    db
      .prepare(
        `UPDATE jobs SET status = 'queued', lease_until = NULL, error = ?1, updated_at = datetime('now'),
           run_after = datetime('now', '+' || LEAST(?2 * (1::bigint << (attempts - 1)::int), ?3) || ' seconds')
         WHERE id = ?4 AND status = 'running' AND attempts = ?5 AND ?6 = 1 AND attempts < max_attempts`,
      )
      .bind(message, BASE_RETRY_SECONDS, MAX_RETRY_SECONDS, jobId, expectedAttempts, retryable ? 1 : 0),
    db
      .prepare(
        `UPDATE jobs SET status = 'failed', lease_until = NULL, error = ?1,
           updated_at = datetime('now'), finished_at = datetime('now')
         WHERE id = ?2 AND status = 'running' AND attempts = ?3`,
      )
      .bind(message, jobId, expectedAttempts),
    refundStatement(db, jobId, expectedAttempts),
  ]);
  if (retried.meta.changes === 1) return "queued";
  const row = await db.prepare("SELECT status FROM jobs WHERE id = ?").bind(jobId).first<{ status: JobStatus }>();
  return row?.status ?? null;
}

/**
 * Put a running job back in the queue without spending a retry: the attempt still counts
 * (attempts only grows, so the fencing token stays unique) and max_attempts grows with it.
 */
export async function deferJob(db: D1Database, jobId: string, expectedAttempts: number, seconds: number): Promise<boolean> {
  const wait = Math.min(Math.max(Math.round(seconds), 5), 3600);
  const result = await db
    .prepare(
      `UPDATE jobs SET status = 'queued', lease_until = NULL, max_attempts = max_attempts + 1,
         run_after = datetime('now', ?1), updated_at = datetime('now')
       WHERE id = ?2 AND status = 'running' AND attempts = ?3`,
    )
    .bind(`+${wait} seconds`, jobId, expectedAttempts)
    .run();
  return result.meta.changes === 1;
}

/** Jobs whose worker died mid-run: count the lost attempt and retry or fail them.
 * The attempt number read here is the fencing token that keeps the stalled worker out. */
export async function recoverExpiredLeases(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare("SELECT id, attempts FROM jobs WHERE status = 'running' AND lease_until < datetime('now')")
    .all<{ id: string; attempts: number }>();
  for (const { id, attempts } of results) await failJob(db, id, attempts, "worker lease expired");
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
    await failJob(db, job.id, job.attempts, `no handler for kind '${job.kind}'`, false);
    return;
  }
  try {
    const { output, providerCostUsd } = await handler(job);
    const applied = await completeJob(db, job.id, job.attempts, output, providerCostUsd);
    if (!applied) console.error("job fencing: discarded result from a worker that lost its lease", job.id, job.kind);
  } catch (err) {
    if (err instanceof JobDeferredError) {
      if (!(await deferJob(db, job.id, job.attempts, err.seconds))) console.error("job fencing: lost the lease while deferring", job.id, job.kind);
      return;
    }
    // Keep provider error details (which can carry customer content) out of logs and the job row.
    const summary = errorSummary(err);
    console.error("job failed", job.id, job.kind, summary);
    await failJob(db, job.id, job.attempts, summary, !(err instanceof PermanentJobError));
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

function refundStatement(db: D1Database, jobId: string, expectedAttempts: number) {
  // The unique (job_id, reason) index makes a second refund a no-op, and the attempts guard
  // pairs the refund with the failed attempt this call claimed — a fenced worker never
  // refunds an attempt it no longer owns.
  return db
    .prepare(
      `INSERT OR IGNORE INTO credit_ledger (user_id, delta, reason, job_id)
       SELECT user_id, cost_credits, 'job_refund', id FROM jobs WHERE id = ? AND status = 'failed' AND attempts = ?`,
    )
    .bind(jobId, expectedAttempts);
}

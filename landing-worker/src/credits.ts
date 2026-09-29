// Credits are an append-only ledger (migrations/0002_credits_jobs.sql).
// Holds and refunds for jobs are written by jobs.ts in the same batch as the job.

export interface Plan {
  id: string;
  name: string;
  monthly_credits: number;
  max_parallel_jobs: number;
  price_thb: number;
}

/** SQL for the plan id a user is on: their active subscription, else 'free'. */
export const PLAN_ID_SQL =
  "COALESCE((SELECT plan_id FROM subscriptions WHERE user_id = ?1 AND status = 'active'), 'free')";

export async function getBalance(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE user_id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}

export async function getPlan(db: D1Database, userId: string): Promise<Plan> {
  const plan = await db.prepare(`SELECT * FROM plans WHERE id = ${PLAN_ID_SQL}`).bind(userId).first<Plan>();
  if (!plan) throw new Error("plan missing: seed the 'free' plan from migrations/0002_credits_jobs.sql");
  return plan;
}

/** Add credits (an admin grant now, a payment later). Returns the new balance. */
export async function grantCredits(
  db: D1Database,
  userId: string,
  amount: number,
  reason: "grant" | "purchase",
  note = "",
): Promise<number> {
  if (!userId) throw new RangeError("userId is required");
  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError("amount must be a positive integer");
  await db
    .prepare("INSERT INTO credit_ledger (user_id, delta, reason, note) VALUES (?, ?, ?, ?)")
    .bind(userId, amount, reason, note.slice(0, 200))
    .run();
  return getBalance(db, userId);
}

export async function ledgerFor(db: D1Database, userId: string, limit = 50) {
  const { results } = await db
    .prepare("SELECT id, delta, reason, job_id, note, created_at FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .bind(userId, limit)
    .all();
  return results;
}

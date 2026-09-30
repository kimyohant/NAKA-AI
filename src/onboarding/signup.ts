// Phase 5B signup bonus (docs/phase5-onboarding.md).
// The amount comes from the SIGNUP_CREDITS env var — the business owner picks
// the number, so it is never hard-coded. An unset, empty, or non-positive-
// integer value means no bonus is granted at all.
import type { Env } from '../types';

// Claude adds SIGNUP_CREDITS to Env in src/types.ts at merge
// (docs/onboarding-integration-status.md); until then it is read through this
// local type so the repo typechecks without touching shared files.
type EnvWithSignupCredits = Env & { SIGNUP_CREDITS?: string };

/** Positive integer credits to grant once at signup, or 0 when not granting. */
export function signupCredits(env: Env): number {
  const raw = (env as EnvWithSignupCredits).SIGNUP_CREDITS;
  const amount = Number(raw);
  return raw !== undefined && raw !== '' && Number.isInteger(amount) && amount > 0 ? amount : 0;
}

/**
 * Idempotent grant statement, appended to identityUser()'s batch so the bonus
 * is written in the same transaction as the new user row (migrations/0002:
 * credit_ledger.reason allows 'grant'; id is AUTOINCREMENT and job_id stays
 * NULL, so the per-job unique index does not apply). The guarded INSERT only
 * fires when this batch actually created the user — a re-login reuses the
 * existing identity, so the fresh UUID is absent from users and no row is
 * written a second time.
 */
export function signupBonusStatement(db: D1Database, userId: string, amount: number) {
  return db
    .prepare(
      `INSERT INTO credit_ledger (user_id, delta, reason, note)
       SELECT ?, ?, 'grant', 'signup_bonus'
       WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
         AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE user_id = ? AND note = 'signup_bonus')`,
    )
    .bind(userId, amount, userId, userId);
}

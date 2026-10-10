-- naka-ai credits held for a generation task (src/core/auth/credits.ts, docs/credit-pricing.md at the repo root):
-- credit_hold_id = the account.credit_ledger id of the hold, credits_charged = how many. NULL = nothing held.
ALTER TABLE "sys_task" ADD COLUMN IF NOT EXISTS "credit_hold_id" bigint;
ALTER TABLE "sys_task" ADD COLUMN IF NOT EXISTS "credits_charged" bigint;

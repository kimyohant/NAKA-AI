-- Packages are paid through Stripe Checkout (Omise no longer onboards sole proprietors).
-- Stripe's hosted page picks PromptPay or card itself, so payments.method gains
-- 'stripe_checkout' and each payment keeps its Checkout Session id. SQLite cannot change a
-- CHECK constraint in place, so the table is rebuilt.
--
-- receipts.payment_id references payments(id). D1 applies this file as one transaction and
-- checks deferred foreign keys at commit: dropping payments leaves receipts pointing nowhere
-- for a moment, and re-inserting every payment into the new `payments` table resolves them.
-- (Inserting into a differently named table and renaming it would not.)
PRAGMA defer_foreign_keys = on;

CREATE TABLE payments_backup AS SELECT * FROM payments;
DROP TABLE payments;
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  period TEXT NOT NULL CHECK (period IN ('monthly', 'yearly')),
  amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
  method TEXT NOT NULL CHECK (method IN ('promptpay', 'card', 'stripe_checkout')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'successful', 'failed', 'expired')),
  omise_charge_id TEXT UNIQUE,
  stripe_session_id TEXT UNIQUE,
  qr_image_url TEXT,
  expires_at INTEGER,
  apply_token TEXT,              -- set by the one call that applies the package
  failure TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
INSERT INTO payments (id, user_id, plan_id, period, amount_satang, method, status, omise_charge_id,
  qr_image_url, expires_at, apply_token, failure, created_at, paid_at)
SELECT id, user_id, plan_id, period, amount_satang, method, status, omise_charge_id,
  qr_image_url, expires_at, apply_token, failure, created_at, paid_at FROM payments_backup;
DROP TABLE payments_backup;
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at);

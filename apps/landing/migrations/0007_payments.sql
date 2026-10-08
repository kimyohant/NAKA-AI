-- Prepaid packages paid through Omise (PromptPay QR or card). See src/billing/.
-- Times are Unix seconds. Amounts are satang (THB x 100), as Omise expects.

ALTER TABLE subscriptions ADD COLUMN expires_at INTEGER;       -- NULL = no end (set by an admin)
ALTER TABLE subscriptions ADD COLUMN billing_period TEXT;      -- 'monthly' | 'yearly'
ALTER TABLE subscriptions ADD COLUMN next_credit_at INTEGER;   -- next monthly credit top-up

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  period TEXT NOT NULL CHECK (period IN ('monthly', 'yearly')),
  amount_satang INTEGER NOT NULL CHECK (amount_satang > 0),
  method TEXT NOT NULL CHECK (method IN ('promptpay', 'card')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'successful', 'failed', 'expired')),
  omise_charge_id TEXT UNIQUE,
  qr_image_url TEXT,
  expires_at INTEGER,
  apply_token TEXT,              -- set by the one call that applies the package
  failure TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at);

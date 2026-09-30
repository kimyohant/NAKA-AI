-- Immutable receipt snapshots. Allocate seq inside the INSERT, never in a separate read.
-- The year follows the payment's paid_at in Asia/Bangkok; issued_at is Unix seconds.
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
  user_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  number TEXT NOT NULL UNIQUE,
  issued_at INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  UNIQUE (year, seq)
);
CREATE INDEX IF NOT EXISTS idx_receipts_user ON receipts(user_id, issued_at DESC);

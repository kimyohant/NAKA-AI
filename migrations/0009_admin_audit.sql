-- Append-only administrative changes, inserted in the same transaction as their effects.
CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('credits', 'package', 'status')),
  detail TEXT NOT NULL CHECK (json_valid(detail)),
  note TEXT NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_user ON admin_audit(user_id, created_at DESC);

-- One-time codes for signing members into naka-studio (src/auth/studio.ts). A code lives 60 seconds,
-- is stored only as its SHA-256 and is deleted when naka-studio redeems it.
CREATE TABLE IF NOT EXISTS studio_sso_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_studio_sso_codes_expires ON studio_sso_codes(expires_at);

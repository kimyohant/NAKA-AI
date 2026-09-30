-- One row per reset request. Unknown emails get a row too (no user, no token) so the rate limits
-- count them. email_key / ip_key are HMACs as in auth_password_attempts, never the values.
CREATE TABLE IF NOT EXISTS auth_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_key TEXT NOT NULL,
  ip_key TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE,          -- SHA-256 of the emailed token; the token itself is never stored
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_password_resets_email ON auth_password_resets(email_key, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_password_resets_ip ON auth_password_resets(ip_key, created_at);

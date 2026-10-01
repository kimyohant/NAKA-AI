-- Sign-up with email + password (src/auth/password.ts). An account is an auth_identities row with
-- provider 'password' and provider_uid = the lower-cased email; its hash lives in auth_passwords.
-- SQLite cannot change the provider CHECK in place, so auth_identities is rebuilt as in 0011
-- (nothing references it; its user_id points outward to users).
CREATE TABLE auth_identities_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('phone', 'google', 'line', 'password')),
  provider_uid TEXT NOT NULL,
  email TEXT,
  verified_at INTEGER NOT NULL,
  UNIQUE (provider, provider_uid)
);
INSERT INTO auth_identities_new (id, user_id, provider, provider_uid, email, verified_at)
SELECT id, user_id, provider, provider_uid, email, verified_at FROM auth_identities;
DROP TABLE auth_identities;
ALTER TABLE auth_identities_new RENAME TO auth_identities;
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);

-- PBKDF2-SHA256 hash of the password: "pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>".
CREATE TABLE IF NOT EXISTS auth_passwords (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Failed sign-ins and sign-ups, for rate limits. key is an HMAC of the email or the IP, never the value.
CREATE TABLE IF NOT EXISTS auth_password_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('login', 'register')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_password_attempts ON auth_password_attempts(key, kind, created_at);

-- Admin password resets are audited like the other customer changes (src/admin/customers.ts).
-- admin_audit is append-only and nothing references it; rebuild it to allow the new action.
CREATE TABLE admin_audit_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('credits', 'package', 'status', 'password')),
  detail TEXT NOT NULL CHECK (json_valid(detail)),
  note TEXT NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL
);
INSERT INTO admin_audit_new (id, user_id, action, detail, note, created_at)
SELECT id, user_id, action, detail, note, created_at FROM admin_audit ORDER BY rowid; -- keeps the history order
DROP TABLE admin_audit;
ALTER TABLE admin_audit_new RENAME TO admin_audit;
CREATE INDEX IF NOT EXISTS idx_admin_audit_user ON admin_audit(user_id, created_at DESC);

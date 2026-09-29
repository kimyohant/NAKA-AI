-- Auth timestamps are Unix seconds. Existing LINE tables are untouched.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled'))
);
CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('phone', 'google')),
  provider_uid TEXT NOT NULL,
  email TEXT,
  verified_at INTEGER NOT NULL,
  UNIQUE (provider, provider_uid)
);
CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS otp_codes (
  phone TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_codes_expiry ON otp_codes(expires_at);
-- Separate history keeps send limits intact after verification or failed delivery.
CREATE TABLE IF NOT EXISTS auth_otp_requests (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_requests_phone ON auth_otp_requests(phone, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_requests_ip ON auth_otp_requests(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_requests_expiry ON auth_otp_requests(created_at);
CREATE TABLE IF NOT EXISTS auth_oauth_states (
  id TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON auth_oauth_states(expires_at);

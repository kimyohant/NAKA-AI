-- All timestamps are Unix seconds. Tokens are encrypted application-side.
CREATE TABLE IF NOT EXISTS social_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_enc TEXT NOT NULL,
  token_expires_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'error')),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, platform, external_id),
  UNIQUE (id, user_id)
);
CREATE TABLE IF NOT EXISTS social_media (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('video/mp4', 'video/webm')),
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 52428800),
  created_at INTEGER NOT NULL,
  UNIQUE (key, user_id)
);
CREATE TABLE IF NOT EXISTS social_oauth_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_oauth_expiry ON social_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  social_account_id TEXT NOT NULL,
  media_key TEXT NOT NULL,
  caption TEXT NOT NULL,
  publish_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'publishing', 'published', 'failed')),
  external_post_id TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  lease_id TEXT,
  lease_until INTEGER,
  container_id TEXT,
  phase TEXT NOT NULL DEFAULT 'prepare' CHECK (phase IN ('prepare', 'publish_sent', 'done')),
  polls INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (social_account_id, user_id) REFERENCES social_accounts(id, user_id),
  FOREIGN KEY (media_key, user_id) REFERENCES social_media(key, user_id)
);
CREATE INDEX IF NOT EXISTS idx_social_posts_due ON scheduled_posts(status, next_attempt_at, publish_at);
CREATE INDEX IF NOT EXISTS idx_social_posts_user ON scheduled_posts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_social_posts_lease ON scheduled_posts(status, lease_until);

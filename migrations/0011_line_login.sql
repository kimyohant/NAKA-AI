-- SQLite cannot change the provider CHECK in place. There are no foreign keys
-- pointing to auth_identities; its user_id foreign key points outward to users.
-- Keep the existing rows, uniqueness, and user lookup index while adding LINE.
CREATE TABLE auth_identities_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('phone', 'google', 'line')),
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

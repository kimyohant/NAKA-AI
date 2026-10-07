-- System control panel (/admin/system/, src/system). Settings saved here override the Worker's vars and
-- secrets of the same name; a key without a row falls back to wrangler vars/secrets.
-- Secret values are AES-GCM ciphertext (SETTINGS_KEY); `hint` is the last four characters, never the value.
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
  value TEXT NOT NULL,
  secret INTEGER NOT NULL CHECK (secret IN (0, 1)),
  hint TEXT,
  updated_at INTEGER NOT NULL
);

-- Append-only history of system changes. Secret values never appear in detail, only their hints.
CREATE TABLE IF NOT EXISTS system_audit (
  id TEXT PRIMARY KEY,
  area TEXT NOT NULL CHECK (area IN ('setting', 'plan')),
  target TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('set', 'clear', 'import', 'create', 'update')),
  detail TEXT NOT NULL CHECK (json_valid(detail)),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  actor TEXT NOT NULL DEFAULT '', -- admin Google email, or "โทเคนฉุกเฉิน" for ADMIN_TOKEN
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_system_audit_created ON system_audit(created_at DESC);

-- A package that is off sale disappears from pricing and checkout; current subscribers keep it.
ALTER TABLE plans ADD COLUMN on_sale INTEGER NOT NULL DEFAULT 1 CHECK (on_sale IN (0, 1));

-- Apply after auth, credits/jobs and social migrations. All inbox times are Unix seconds.
CREATE TABLE IF NOT EXISTS inbox_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','draft','auto')),
  tone TEXT NOT NULL DEFAULT 'สุภาพ เป็นกันเอง',
  escalate_keywords TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inbox_kb (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_kb_user ON inbox_kb(user_id);
CREATE TABLE IF NOT EXISTS inbox_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  social_account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('comment','dm')),
  external_thread_id TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','needs_human','closed')),
  last_message_at INTEGER NOT NULL,
  last_customer_at INTEGER NOT NULL DEFAULT 0,
  last_inbound_id TEXT,
  media_id TEXT,
  auto_paused INTEGER NOT NULL DEFAULT 0 CHECK (auto_paused IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE (social_account_id, kind, external_thread_id),
  UNIQUE (id, user_id),
  FOREIGN KEY (social_account_id, user_id) REFERENCES social_accounts(id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_inbox_threads_user ON inbox_threads(user_id,status,last_message_at);
CREATE TABLE IF NOT EXISTS inbox_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  external_id TEXT UNIQUE,
  body TEXT NOT NULL,
  draft TEXT,
  confidence TEXT CHECK (confidence IN ('high','low')),
  handoff_reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('received','pending','drafted','sent','skipped','failed')),
  approved_by TEXT,
  sent_at INTEGER,
  created_at INTEGER NOT NULL,
  message_at INTEGER NOT NULL,
  reply_target TEXT NOT NULL,
  queue_token TEXT,
  queue_until INTEGER,
  job_id TEXT,
  draft_lock TEXT,
  draft_until INTEGER,
  thread_revision INTEGER,
  settings_revision INTEGER,
  send_phase TEXT NOT NULL DEFAULT 'ready' CHECK (send_phase IN ('ready','sending','sent','uncertain')),
  send_started_at INTEGER,
  reply_external_id TEXT,
  error TEXT,
  FOREIGN KEY (thread_id, user_id) REFERENCES inbox_threads(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_thread ON inbox_messages(thread_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_pending ON inbox_messages(status,queue_until,created_at);
-- Durable receipt before HTTP 200. Background work can resume after waitUntil expires.
CREATE TABLE IF NOT EXISTS inbox_webhook_receipts (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  cursor INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  lease_id TEXT,
  lease_until INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_receipts_pending ON inbox_webhook_receipts(status,lease_until,created_at);

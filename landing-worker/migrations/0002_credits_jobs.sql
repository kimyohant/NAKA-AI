-- Phase 1: credits ledger and the AI job queue. See docs/phase1-tasks.md.
-- user_id refers to users.id from 0001_auth.sql; no foreign key so either
-- migration can be applied and tested on its own.

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_credits INTEGER NOT NULL DEFAULT 0,
  max_parallel_jobs INTEGER NOT NULL,     -- queued + running jobs a user may have at once
  price_thb INTEGER NOT NULL DEFAULT 0
);

-- Only the free tier is seeded; paid tiers wait for pricing decisions.
INSERT OR IGNORE INTO plans (id, name, monthly_credits, max_parallel_jobs, price_thb) VALUES
  ('free', 'ฟรี', 0, 1, 0);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
  period_end TEXT,
  provider_ref TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only. Balance = SUM(delta); never store a balance column.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('grant', 'purchase', 'job_hold', 'job_refund')),
  job_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(user_id);
-- One hold and at most one refund per job, so a retried failure cannot refund twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_job_reason ON credit_ledger(job_id, reason) WHERE job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- e.g. 'image' | 'video' | 'tts' | 'script'
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  priority INTEGER NOT NULL DEFAULT 0,    -- higher runs first
  input TEXT NOT NULL DEFAULT '{}',       -- JSON
  output TEXT,                            -- JSON
  cost_credits INTEGER NOT NULL,
  provider_cost_usd REAL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TEXT NOT NULL DEFAULT (datetime('now')),
  lease_until TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(status, priority DESC, run_after);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, status);

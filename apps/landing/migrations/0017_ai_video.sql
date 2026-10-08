-- AI marketer: real AI video (src/video). A seller's uploads live in R2 (MEDIA binding) under
-- marketer/<userId>/; this table records who owns each object so links are only signed for owners.
CREATE TABLE IF NOT EXISTS marketer_media (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'image', 'output')),
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  -- A person's photo may only be used once the seller confirms consent (or that the face is AI-made).
  person TEXT CHECK (person IS NULL OR person IN ('consented', 'ai_generated')),
  consent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marketer_media_user ON marketer_media(user_id, created_at DESC);

-- One AI video per row; the credit hold and retries ride on the jobs row (job_id, kind 'ai_video').
CREATE TABLE IF NOT EXISTS ai_videos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('recreate', 'replace', 'product', 'plan')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL CHECK (length(prompt) <= 7000),
  input TEXT NOT NULL CHECK (json_valid(input)), -- media keys, duration, ratio, resolution
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'submitting', 'submitted', 'done', 'failed')),
  provider_task_id TEXT,
  submitted_at INTEGER,
  output_key TEXT,
  duration_sec REAL,
  error TEXT,
  cost_credits INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_videos_user ON ai_videos(user_id, created_at DESC);

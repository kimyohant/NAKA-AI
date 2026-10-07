-- AI marketer (/studio/marketer/, src/marketer): "trending videos, ready to replicate".
-- Rows come from three places: added by an admin (curated), imported from a FastMoss/Kalodata
-- export file (import), or pulled from a data provider's API by the cron (api).
CREATE TABLE IF NOT EXISTS trending_videos (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('curated', 'import', 'api')),
  url TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'tiktok' CHECK (platform IN ('tiktok', 'facebook', 'instagram', 'youtube')),
  region TEXT NOT NULL DEFAULT 'TH' CHECK (length(region) = 2),
  category TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 600),
  author TEXT NOT NULL DEFAULT '' CHECK (length(author) <= 120),
  product_name TEXT NOT NULL DEFAULT '' CHECK (length(product_name) <= 200),
  thumbnail_url TEXT CHECK (thumbnail_url IS NULL OR length(thumbnail_url) <= 2000),
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  likes INTEGER NOT NULL DEFAULT 0 CHECK (likes >= 0),
  comments INTEGER NOT NULL DEFAULT 0 CHECK (comments >= 0),
  shares INTEGER NOT NULL DEFAULT 0 CHECK (shares >= 0),
  revenue_thb INTEGER CHECK (revenue_thb IS NULL OR revenue_thb >= 0), -- NULL = unknown
  published_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  added_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trending_list ON trending_videos(active, region, category, views DESC);
CREATE INDEX IF NOT EXISTS idx_trending_refresh ON trending_videos(platform, updated_at);

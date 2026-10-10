-- What each piece of work costs in credits, set by the owner in /admin/system/ (ราคาเครดิต) — docs/credit-pricing.md.
-- One row per chargeable work. credits = 0 means free. A row with per_second charges credits × seconds
-- (videos only, where allow_per_second); the amount charged is always rounded up to whole credits.
-- The landing reads it for its own jobs (src/credit-prices.ts); studio_app may SELECT it for Naka Studio's
-- image and video tasks, which hold credits through hold_credits() (0002_shared.sql).

CREATE TABLE credit_prices (
  key text PRIMARY KEY,
  app text NOT NULL CHECK (app IN ('landing', 'studio')),
  label text NOT NULL,
  unit_label text NOT NULL,                       -- what one item is called on the page, e.g. 'ภาพ', 'คลิป'
  credits numeric(10, 2) NOT NULL CHECK (credits >= 0 AND credits <= 1000),
  per_second boolean NOT NULL DEFAULT false,
  allow_per_second boolean NOT NULL DEFAULT false,
  sort_order bigint NOT NULL DEFAULT 0,
  updated_at bigint NOT NULL DEFAULT 0,           -- unix seconds; 0 = the seeded default
  actor text NOT NULL DEFAULT '',
  CHECK (NOT per_second OR allow_per_second)
);

-- Starting prices: the landing keeps what it charged before (the AI video price saved in system settings
-- moves here, see below); Naka Studio starts with videos at the landing's AI video price and images free,
-- because one drama needs dozens of images and the monthly video quota already caps the expensive work.
INSERT INTO credit_prices (key, app, label, unit_label, credits, per_second, allow_per_second, sort_order) VALUES
  ('studio.video',     'studio',  'Naka Studio: สร้างวิดีโอ',      'คลิป', 5, false, true,  10),
  ('studio.image',     'studio',  'Naka Studio: สร้างภาพ',         'ภาพ',  0, false, false, 20),
  ('landing.ai_video', 'landing', 'วิดีโอ AI (หน้าเว็บ naka-ai)',   'คลิป', 5, false, false, 30),
  ('landing.clips',    'landing', 'คลิปรีวิวสินค้า',               'คลิป', 1, false, false, 40),
  ('landing.marketer', 'landing', 'นักการตลาด AI (หน้าเว็บ naka-ai)', 'งาน',  1, false, false, 50);

-- The AI video price used to be the AI_VIDEO_CREDITS system setting (a plain number, 1–100). Keep a saved value.
UPDATE credit_prices SET credits = s.value::numeric
  FROM system_settings s
 WHERE credit_prices.key = 'landing.ai_video' AND s.key = 'AI_VIDEO_CREDITS' AND s.secret = 0
   AND s.value ~ '^[0-9]{1,3}$' AND s.value::integer BETWEEN 1 AND 100;
DELETE FROM system_settings WHERE key = 'AI_VIDEO_CREDITS';

-- Price changes are audited like plans and settings: system_audit area 'price', action 'update'.
ALTER TABLE system_audit DROP CONSTRAINT system_audit_area_check;
ALTER TABLE system_audit ADD CONSTRAINT system_audit_area_check CHECK (area IN ('setting', 'plan', 'studio', 'price'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    GRANT SELECT ON credit_prices TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_ro') THEN
    GRANT SELECT ON credit_prices TO reporting_ro;
  END IF;
END $$;

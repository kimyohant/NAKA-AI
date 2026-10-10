-- Site content managed from the back office (page /admin/content/, docs/admin-backoffice.md):
-- the showcase clips on the home page (src/content/showcase.ts) and announcements to customers
-- (src/content/announcements.ts). Changes are recorded in system_audit under area 'content'.
-- Runs as account_app with search_path = account; never name the schema here.

-- Home-page gallery. The cards written in public/index.html stay there; a row here only changes one
-- (hide it, or give it a place in the order) or adds an uploaded clip. No rows = the page as written.
CREATE TABLE showcase_clips (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 300), -- 'static:<card key>' for written cards, a uuid for uploads
  kind text NOT NULL CHECK (kind IN ('static', 'upload')),
  category text NOT NULL DEFAULT '' CHECK (category IN ('', 'review', 'drama', 'live', 'bot')),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 80),
  subtitle text NOT NULL DEFAULT '' CHECK (length(subtitle) <= 120),
  chip text NOT NULL DEFAULT '' CHECK (length(chip) <= 30),
  video_key text,                     -- MEDIA keys, uploads only
  poster_key text,
  hidden bigint NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  sort bigint,                        -- null = the card's place in public/index.html
  updated_by text NOT NULL DEFAULT '',
  updated_at bigint NOT NULL,
  CHECK (kind = 'static' OR (category <> '' AND title <> '' AND video_key IS NOT NULL AND poster_key IS NOT NULL))
);

-- One line shown at the top of the site's pages while it is in its time window; the newest active one wins.
CREATE TABLE announcements (
  id text PRIMARY KEY,
  message text NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 200),
  link_url text CHECK (link_url IS NULL OR link_url ~ '^(https://|/[^/])'),
  link_label text NOT NULL DEFAULT '' CHECK (length(link_label) <= 30),
  tone text NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'promo', 'warning')),
  starts_at bigint NOT NULL,
  ends_at bigint,                     -- null = until switched off
  active bigint NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by text NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX announcements_live ON announcements (active, starts_at DESC);

ALTER TABLE system_audit DROP CONSTRAINT system_audit_area_check;
ALTER TABLE system_audit ADD CONSTRAINT system_audit_area_check CHECK (area IN ('setting', 'plan', 'studio', 'price', 'alert', 'content'));

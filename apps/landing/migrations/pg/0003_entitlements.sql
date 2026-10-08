-- What each member may use (docs/entitlements.md): features (a landing area or a studio menu) that a plan
-- includes, with an optional monthly quota, and per-member overrides an admin sets with a reason.
--
-- Runs as account_app with search_path = account; never names its schema (see 0002_shared.sql).
-- The effective rules live in SQL (member_features / use_feature) so the landing and the studio read the
-- same answer: the studio calls them as studio_app (EXECUTE only, SECURITY DEFINER), like the credit holds.
--
-- effective(member, feature):
--   member not active                        → off
--   override present and not expired         → override.enabled, limit = override.monthly_limit ?? plan's limit
--   otherwise                                → on when the member's current plan includes it, with the plan's limit
-- The current plan is the active, unexpired subscription, else 'free' (as admin/customers.ts reads it).
-- A NULL limit means unlimited. Usage is counted per calendar month in Asia/Bangkok.
-- System-wide switches (FEATURE_* in /admin/system/) still close a landing area for everyone; the landing
-- applies them on top of this (src/entitlements.ts).

CREATE TABLE features (
  key text PRIMARY KEY CHECK (key ~ '^(landing|studio)\.[a-z_]{2,40}$'),
  app text NOT NULL CHECK (app IN ('landing', 'studio')),
  label text NOT NULL,
  quota_unit text,                          -- NULL: on/off only; else what one unit of quota is ('คลิป', 'วิดีโอ')
  sort_order bigint NOT NULL DEFAULT 0,
  CHECK (split_part(key, '.', 1) = app)
);

CREATE TABLE plan_features (
  plan_id text NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES features(key) ON DELETE CASCADE,
  monthly_limit bigint CHECK (monthly_limit IS NULL OR monthly_limit >= 0),   -- NULL = unlimited
  PRIMARY KEY (plan_id, feature_key)
);

CREATE TABLE user_features (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES features(key) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  monthly_limit bigint CHECK (monthly_limit IS NULL OR monthly_limit >= 0),   -- NULL = the plan's limit
  expires_at bigint,                                                          -- unix seconds; NULL = no end
  note text NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 200),
  actor text NOT NULL DEFAULT '',
  updated_at bigint NOT NULL,
  PRIMARY KEY (user_id, feature_key)
);

CREATE TABLE feature_usage (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES features(key) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  used bigint NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (user_id, feature_key, period)
);

-- per-member feature changes are audited with the other customer actions
ALTER TABLE admin_audit DROP CONSTRAINT admin_audit_action_check;
ALTER TABLE admin_audit ADD CONSTRAINT admin_audit_action_check
  CHECK (action IN ('credits', 'package', 'status', 'password', 'feature'));

INSERT INTO features (key, app, label, quota_unit, sort_order) VALUES
  ('landing.clips',          'landing', 'คลิปรีวิวสินค้า',        'คลิป',   10),
  ('landing.marketer',       'landing', 'นักการตลาด AI',          'งาน',    20),
  ('landing.ai_video',       'landing', 'วิดีโอ AI',              'วิดีโอ', 30),
  ('landing.social',         'landing', 'โพสต์โซเชียลอัตโนมัติ', NULL,     40),
  ('landing.inbox',          'landing', 'AI Inbox',              NULL,     50),
  ('studio.drama',           'studio',  'สตูดิโอ: ละครสั้น',       NULL,     110),
  ('studio.marketer',        'studio',  'สตูดิโอ: Marketer',      NULL,     120),
  ('studio.seller',          'studio',  'สตูดิโอ: AI นักขาย',      NULL,     130),
  ('studio.product_studio',  'studio',  'สตูดิโอ: Product Studio', NULL,    140),
  ('studio.viral_clone',     'studio',  'สตูดิโอ: Viral Clone',   NULL,     150),
  ('studio.live',            'studio',  'สตูดิโอ: AI Live',       NULL,     160),
  ('studio.video',           'studio',  'สตูดิโอ: สร้างวิดีโอ AI', 'วิดีโอ', 170);

-- Starting matrix — a placeholder for the owner to tune in /admin/system/ (แพ็กเกจ). Credits still price
-- every job; these quotas only cap the expensive video work per month.
INSERT INTO plan_features (plan_id, feature_key, monthly_limit)
SELECT p.id, f.key, CASE f.key
    WHEN 'landing.ai_video' THEN CASE p.id WHEN 'starter' THEN 10 WHEN 'pro' THEN 30 WHEN 'business' THEN 80 ELSE 200 END
    WHEN 'studio.video'     THEN CASE p.id WHEN 'starter' THEN 10 WHEN 'pro' THEN 30 WHEN 'business' THEN 80 ELSE 200 END
    WHEN 'landing.clips'    THEN CASE p.id WHEN 'free' THEN 3 END
    WHEN 'landing.marketer' THEN CASE p.id WHEN 'free' THEN 5 END
  END
FROM plans p JOIN features f ON CASE p.id
    WHEN 'free'     THEN f.key IN ('landing.clips', 'landing.marketer')
    WHEN 'starter'  THEN f.key IN ('landing.clips', 'landing.marketer', 'landing.ai_video', 'landing.social',
                                   'studio.drama', 'studio.seller', 'studio.product_studio', 'studio.video')
    WHEN 'pro'      THEN f.key NOT IN ('studio.live')
    ELSE true                                                   -- business, max and plans added later by hand
  END
WHERE p.id IN ('free', 'starter', 'pro', 'business', 'max');

-- 'YYYY-MM' in Thailand: the month a use counts in
CREATE FUNCTION feature_period() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')
$$;

-- member_features(user) → one row per feature: whether the member may use it now, the monthly limit
-- (NULL = unlimited, always NULL for features without a quota), this month's use and where the answer
-- came from ('override' | 'plan' | 'none'). Unknown or disabled members get every feature off.
CREATE FUNCTION member_features(p_user text)
RETURNS TABLE (feature_key text, app text, label text, quota_unit text, enabled boolean,
               monthly_limit bigint, used bigint, source text, plan_id text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH t AS (SELECT extract(epoch FROM now())::bigint AS now_s, feature_period() AS period),
  member AS (
    SELECT u.status,
      coalesce((SELECT s.plan_id FROM subscriptions s, t WHERE s.user_id = u.id AND s.status = 'active'
                  AND (s.expires_at IS NULL OR s.expires_at > t.now_s)), 'free') AS plan_id
    FROM users u WHERE u.id = p_user
  )
  SELECT f.key, f.app, f.label, f.quota_unit,
    coalesce(m.status = 'active', false) AND CASE WHEN o.user_id IS NOT NULL THEN o.enabled ELSE pf.plan_id IS NOT NULL END,
    CASE WHEN f.quota_unit IS NULL THEN NULL
         WHEN o.user_id IS NOT NULL AND o.monthly_limit IS NOT NULL THEN o.monthly_limit
         ELSE pf.monthly_limit END,
    coalesce(fu.used, 0),
    CASE WHEN o.user_id IS NOT NULL THEN 'override' WHEN pf.plan_id IS NOT NULL THEN 'plan' ELSE 'none' END,
    m.plan_id
  FROM features f CROSS JOIN t
  LEFT JOIN member m ON true
  LEFT JOIN plan_features pf ON pf.feature_key = f.key AND pf.plan_id = m.plan_id
  LEFT JOIN user_features o ON o.feature_key = f.key AND o.user_id = p_user AND (o.expires_at IS NULL OR o.expires_at > t.now_s)
  LEFT JOIN feature_usage fu ON fu.user_id = p_user AND fu.feature_key = f.key AND fu.period = t.period
  ORDER BY f.sort_order, f.key
$$;

-- use_feature(user, feature, amount) → (ok, reason, used, monthly_limit, period)
--   ok = true:  the member may use it; `amount` is added to this month's use (also when unlimited).
--   ok = false: reason 'disabled' (not included / switched off / member not active) or 'quota' (the month's
--               limit would be passed). Nothing is written.
-- One statement decides and counts: ON CONFLICT … DO UPDATE re-checks the limit on the locked row, so two
-- concurrent uses cannot both take the last unit. Unknown feature: error.
CREATE FUNCTION use_feature(p_user text, p_feature text, p_amount bigint DEFAULT 1)
RETURNS TABLE (ok boolean, reason text, used bigint, monthly_limit bigint, period text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
#variable_conflict use_column
DECLARE
  v_enabled boolean;
  v_limit bigint;
  v_period text := feature_period();
  v_used bigint;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'use_feature: amount must be positive, got %', p_amount USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT mf.enabled, mf.monthly_limit INTO v_enabled, v_limit FROM member_features(p_user) mf WHERE mf.feature_key = p_feature;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'use_feature: unknown feature %', p_feature USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT v_enabled THEN
    RETURN QUERY SELECT false, 'disabled'::text, NULL::bigint, v_limit, v_period;
    RETURN;
  END IF;
  INSERT INTO feature_usage AS fu (user_id, feature_key, period, used)
    SELECT p_user, p_feature, v_period, p_amount WHERE v_limit IS NULL OR p_amount <= v_limit
  ON CONFLICT (user_id, feature_key, period) DO UPDATE SET used = fu.used + EXCLUDED.used
    WHERE v_limit IS NULL OR fu.used + EXCLUDED.used <= v_limit
  RETURNING fu.used INTO v_used;
  IF v_used IS NULL THEN
    SELECT f.used INTO v_used FROM feature_usage f WHERE f.user_id = p_user AND f.feature_key = p_feature AND f.period = v_period;
    RETURN QUERY SELECT false, 'quota'::text, coalesce(v_used, 0), v_limit, v_period;
    RETURN;
  END IF;
  RETURN QUERY SELECT true, NULL::text, v_used, v_limit, v_period;
END $$;

-- release_feature(user, feature, amount, period) → that month's use afterwards. Gives back a use that did not
-- happen (the job could not even be started). Never below 0; a missing row stays missing (returns 0).
CREATE FUNCTION release_feature(p_user text, p_feature text, p_amount bigint, p_period text)
RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
  WITH r AS (
    UPDATE feature_usage SET used = greatest(used - p_amount, 0)
     WHERE user_id = p_user AND feature_key = p_feature AND period = p_period AND p_amount > 0
    RETURNING used)
  SELECT coalesce((SELECT used FROM r), 0)
$$;

-- Grants: same shape as 0002. SECURITY DEFINER functions get a fixed search_path; nothing is open to
-- PUBLIC; studio_app may only read a member's features and count/give back a use.
DO $$
DECLARE
  s text := quote_ident(current_schema());
BEGIN
  EXECUTE format('ALTER FUNCTION feature_period() SET search_path = %s, pg_temp', s);
  EXECUTE format('ALTER FUNCTION member_features(text) SET search_path = %s, pg_temp', s);
  EXECUTE format('ALTER FUNCTION use_feature(text, text, bigint) SET search_path = %s, pg_temp', s);
  EXECUTE format('ALTER FUNCTION release_feature(text, text, bigint, text) SET search_path = %s, pg_temp', s);
  EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %s FROM PUBLIC', s);

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %s TO studio_app', s);
    GRANT EXECUTE ON FUNCTION member_features(text), use_feature(text, text, bigint),
      release_feature(text, text, bigint, text) TO studio_app;
  END IF;
END $$;

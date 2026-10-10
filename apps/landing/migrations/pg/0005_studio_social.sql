-- naka-studio's Social Auto Reply menu (/social, /api/v1/social) joins the plan features (docs/entitlements.md).
-- Every plan that already includes the site's own social posting (landing.social) gets it too, so a plan
-- the owner tuned in /admin/system/ keeps its shape; starting matrix: starter and up, not free.
INSERT INTO features (key, app, label, quota_unit, sort_order) VALUES
  ('studio.social', 'studio', 'สตูดิโอ: Social Auto Reply', NULL, 165);

INSERT INTO plan_features (plan_id, feature_key, monthly_limit)
SELECT plan_id, 'studio.social', NULL FROM plan_features WHERE feature_key = 'landing.social'
ON CONFLICT DO NOTHING;

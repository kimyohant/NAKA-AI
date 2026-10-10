-- Discount codes (src/billing/coupons.ts, managed on /admin/payments/) and back-office staff with a narrower role
-- (src/admin/auth.ts, managed on /admin/staff/). Changes are recorded in system_audit under areas 'coupon' and 'staff'.
-- Runs as account_app with search_path = account; never name the schema here.

-- A code takes a percentage or a fixed amount off one checkout. A use counts while its payment is paid, or pending
-- and not yet expired, so a checkout left unpaid gives the use back by itself.
CREATE TABLE coupons (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_-]{3,30}$'),
  kind text NOT NULL CHECK (kind IN ('percent', 'amount')),
  value bigint NOT NULL CHECK (value > 0),         -- percent: 1 to 90; amount: baht
  plan_ids text,                                    -- JSON array of plan ids; null = every package
  period text CHECK (period IS NULL OR period IN ('monthly', 'yearly')),
  max_uses bigint CHECK (max_uses IS NULL OR max_uses > 0),
  per_user bigint NOT NULL DEFAULT 1 CHECK (per_user > 0),
  starts_at bigint NOT NULL,
  ends_at bigint,
  active bigint NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  created_by text NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  CHECK (kind <> 'percent' OR value <= 90),
  CHECK (plan_ids IS NULL OR json_valid(plan_ids)),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

ALTER TABLE payments ADD COLUMN coupon_code text REFERENCES coupons(code);
ALTER TABLE payments ADD COLUMN discount_satang bigint NOT NULL DEFAULT 0 CHECK (discount_satang >= 0);
CREATE INDEX payments_coupon ON payments (coupon_code, status) WHERE coupon_code IS NOT NULL;

-- Staff who sign in with Google but are not in ADMIN_EMAILS (those stay the owners, set in the server config).
CREATE TABLE admin_staff (
  email text PRIMARY KEY CHECK (email = lower(email) AND email ~ '^[^\s@]+@[^\s@]+$'),
  role text NOT NULL CHECK (role IN ('support')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  added_by text NOT NULL DEFAULT '',
  created_at bigint NOT NULL
);

ALTER TABLE system_audit DROP CONSTRAINT system_audit_area_check;
ALTER TABLE system_audit ADD CONSTRAINT system_audit_area_check
  CHECK (area IN ('setting', 'plan', 'studio', 'alert', 'content', 'coupon', 'staff'));

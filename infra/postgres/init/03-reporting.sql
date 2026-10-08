-- Read-only reporting views across the apps' schemas (docs/adr/0004-shared-postgres-and-queues.md).
-- Owned by the superuser (schema reporting is its own), readable by reporting_ro only.
--
-- The views read tables the apps create in their own migrations, which run after this folder:
-- on a new volume this file therefore creates nothing (each view is skipped, with a NOTICE, until
-- its tables exist). Run it again once the apps have migrated, and after every change to it — it is
-- idempotent (CREATE OR REPLACE VIEW):
--
--   docker compose exec -T postgres sh -c \
--     'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d naka -f /docker-entrypoint-initdb.d/03-reporting.sql'
--
-- A view's column list can only grow at the end with CREATE OR REPLACE; to reshape one, DROP it here
-- first. Times are grouped in Asia/Bangkok (the business day of a Thai-market shop).

\set ON_ERROR_STOP on

DO $$
BEGIN
  -- Revenue per day: successful payments only, satang → baht.
  IF to_regclass('account.payments') IS NOT NULL THEN
    CREATE OR REPLACE VIEW reporting.revenue_by_day AS
    SELECT (to_timestamp(coalesce(paid_at, created_at)) AT TIME ZONE 'Asia/Bangkok')::date AS day,
           count(*) AS payments,
           (sum(amount_satang) / 100.0)::numeric(14, 2) AS revenue_baht
      FROM account.payments
     WHERE status = 'successful'
     GROUP BY 1;
  ELSE
    RAISE NOTICE 'reporting.revenue_by_day skipped: account.payments does not exist yet';
  END IF;

  -- Credits used per user, net of refunds (an open hold counts as used: it is off the balance),
  -- split by the app that charged them; balance = SUM(delta), as apps/landing/src/credits.ts.
  IF to_regclass('account.credit_ledger') IS NOT NULL THEN
    CREATE OR REPLACE VIEW reporting.credits_used_by_user AS
    SELECT user_id,
           (-coalesce(sum(delta) FILTER (WHERE reason IN ('job_hold', 'job_refund', 'studio_hold', 'studio_refund')), 0))::bigint AS credits_used,
           (-coalesce(sum(delta) FILTER (WHERE reason IN ('job_hold', 'job_refund')), 0))::bigint AS credits_used_landing,
           (-coalesce(sum(delta) FILTER (WHERE reason IN ('studio_hold', 'studio_refund')), 0))::bigint AS credits_used_studio,
           sum(delta)::bigint AS balance
      FROM account.credit_ledger
     GROUP BY user_id;
  ELSE
    RAISE NOTICE 'reporting.credits_used_by_user skipped: account.credit_ledger does not exist yet';
  END IF;

  -- Subscriptions in force now: the rule apps/landing/src/billing uses (active, not past expires_at).
  IF to_regclass('account.subscriptions') IS NOT NULL AND to_regclass('account.plans') IS NOT NULL THEN
    CREATE OR REPLACE VIEW reporting.active_subscriptions AS
    SELECT s.user_id,
           s.plan_id,
           p.name AS plan_name,
           s.billing_period,
           to_timestamp(s.expires_at) AS expires_at,
           to_timestamp(s.next_credit_at) AS next_credit_at
      FROM account.subscriptions s
      JOIN account.plans p ON p.id = s.plan_id
     WHERE s.status = 'active'
       AND (s.expires_at IS NULL OR s.expires_at > extract(epoch FROM now()));
  ELSE
    RAISE NOTICE 'reporting.active_subscriptions skipped: account.subscriptions/plans do not exist yet';
  END IF;
END $$;

-- 01-schemas-roles.sql grants SELECT on new reporting tables by default, but only for objects its
-- own role creates; grant explicitly so a re-run by another superuser keeps reporting_ro working.
GRANT USAGE ON SCHEMA reporting TO reporting_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_ro;

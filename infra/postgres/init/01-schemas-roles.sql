-- NAKA-AI shared database layout (docs/adr/0004-shared-postgres-and-queues.md).
-- Runs once, as the superuser, when the postgres volume is first created.
--
--   schema account    owned by account_app  (apps/landing: users, sessions, credits, payments, …)
--   schema studio     owned by studio_app   (apps/studio: dramas, campaigns, studio_*, clone_*, …)
--   schema reporting  owned by the superuser; read-only views across both, for reporting_ro
--
-- Each app owns (and migrates) its own schema and cannot touch the other one. Anything shared
-- crosses over explicitly: views granted with SELECT, or SECURITY DEFINER functions granted
-- with EXECUTE (e.g. account.hold_credits for studio_app) — added by the owning app's migrations.
-- No foreign keys across schemas.
--
-- Roles are created NOLOGIN here; 02-role-passwords.sh turns on LOGIN with passwords from .env.

\set ON_ERROR_STOP on

CREATE ROLE account_app NOLOGIN;
CREATE ROLE studio_app NOLOGIN;
CREATE ROLE reporting_ro NOLOGIN;

-- nobody but the three app roles may connect; nobody may create objects in public
REVOKE ALL ON DATABASE naka FROM PUBLIC;
GRANT CONNECT ON DATABASE naka TO account_app, studio_app, reporting_ro;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA account AUTHORIZATION account_app;
CREATE SCHEMA studio AUTHORIZATION studio_app;
CREATE SCHEMA reporting;

GRANT USAGE ON SCHEMA reporting TO reporting_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO reporting_ro;

-- Unqualified names resolve to the app's own schema, so existing SQL ("FROM users") keeps working.
ALTER ROLE account_app SET search_path = account;
ALTER ROLE studio_app SET search_path = studio;
ALTER ROLE reporting_ro SET search_path = reporting;

-- Safety nets for app connections
ALTER ROLE account_app SET statement_timeout = '30s';
ALTER ROLE studio_app SET statement_timeout = '60s';
ALTER ROLE reporting_ro SET statement_timeout = '120s';
ALTER ROLE reporting_ro SET default_transaction_read_only = on;

-- Objects other apps use from this schema (docs/adr/0004-shared-postgres-and-queues.md, phase 3):
-- credit holds the studio calls as functions, and a users view without secrets.
--
-- Runs as account_app with search_path = account. The schema is never named (current_schema() where
-- a statement needs it), so the same file runs in the throwaway schemas of the tests. Grants go to the
-- roles from infra/postgres/init/01-schemas-roles.sql and are skipped when a role does not exist
-- (the in-process test database, CI's bare PostgreSQL service).
--
-- What studio_app gets, and nothing else: USAGE on this schema, EXECUTE on hold_credits / commit_hold /
-- refund_hold, SELECT on users_public. reporting_ro gets USAGE + SELECT on users_public.

-- ---------------------------------------------------------------------------------------------
-- Studio holds: own ledger reasons, so a studio ref never shares the (job_id, reason) unique index
-- namespace with a landing job id, and reports can tell the two apart. Balance stays SUM(delta).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_reason_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_reason_check
  CHECK (reason IN ('grant', 'purchase', 'job_hold', 'job_refund', 'studio_hold', 'studio_refund'));

-- One row per studio hold (ledger row with reason 'studio_hold'): held → committed | refunded, once.
CREATE TABLE credit_holds (
  ledger_id bigint PRIMARY KEY REFERENCES credit_ledger(id),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'committed', 'refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

-- hold_credits(user, amount, ref) → (ok, hold_id, balance)
--   ok = true:  the credits are held; hold_id is the credit_ledger id; balance is what is left.
--   ok = false: refused, the balance (returned) is below amount; hold_id is null. Nothing written.
-- Idempotent per ref: calling again with the same (user, ref, amount) returns the existing hold
-- (ok = false if that hold was refunded since). The same ref for another user or another amount
-- is an error. Refs are global across users: the studio should use e.g. 'studio:<task id>'.
--
-- Concurrency: takes pg_advisory_xact_lock(72040002), the single-writer lock the landing adapter
-- (src/db/pg-d1.ts WRITE_LOCK_KEY) takes for every write. A per-user lock would not be enough: the
-- landing's own balance checks (enqueueJob, admin, billing) run under that global lock only, so a
-- studio hold must exclude them too. The lock is held until the caller's transaction ends — keep
-- the transaction that holds credits short. The balance is read after the lock, which only sees
-- the previous holder's row under READ COMMITTED, so other isolation levels are refused.
CREATE FUNCTION hold_credits(p_user text, p_amount bigint, p_ref text)
RETURNS TABLE (ok boolean, hold_id bigint, balance bigint)
LANGUAGE plpgsql SECURITY DEFINER AS $$
#variable_conflict use_column
DECLARE
  v_id bigint;
  v_user text;
  v_amount bigint;
  v_status text;
  v_balance bigint;
BEGIN
  IF coalesce(p_user, '') = '' OR coalesce(p_ref, '') = '' THEN
    RAISE EXCEPTION 'hold_credits: user and ref are required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'hold_credits: amount must be positive, got %', p_amount USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'hold_credits needs READ COMMITTED, the transaction is %', current_setting('transaction_isolation')
      USING ERRCODE = 'invalid_transaction_state';
  END IF;

  PERFORM pg_advisory_xact_lock(72040002);

  SELECT l.id, l.user_id, -l.delta, h.status INTO v_id, v_user, v_amount, v_status
    FROM credit_ledger l JOIN credit_holds h ON h.ledger_id = l.id
   WHERE l.job_id = p_ref AND l.reason = 'studio_hold';
  IF FOUND THEN
    IF v_user <> p_user OR v_amount <> p_amount THEN
      RAISE EXCEPTION 'hold_credits: ref % already holds % credits for another request', p_ref, v_amount
        USING ERRCODE = 'unique_violation';
    END IF;
    SELECT coalesce(sum(delta), 0) INTO v_balance FROM credit_ledger WHERE user_id = p_user;
    RETURN QUERY SELECT v_status <> 'refunded', v_id, v_balance;
    RETURN;
  END IF;

  SELECT coalesce(sum(delta), 0) INTO v_balance FROM credit_ledger WHERE user_id = p_user;
  IF v_balance < p_amount THEN
    RETURN QUERY SELECT false, NULL::bigint, v_balance;
    RETURN;
  END IF;

  INSERT INTO credit_ledger (user_id, delta, reason, job_id) VALUES (p_user, -p_amount, 'studio_hold', p_ref)
    RETURNING id INTO v_id;
  INSERT INTO credit_holds (ledger_id) VALUES (v_id);
  RETURN QUERY SELECT true, v_id, v_balance - p_amount;
END $$;

-- commit_hold(hold_id) → the hold's status afterwards: 'committed' (now or before), or 'refunded'
-- when it was refunded first (nothing to commit). Unknown hold_id: error no_data_found.
-- After a commit, refund_hold refuses. The row lock on credit_holds orders commit vs refund.
CREATE FUNCTION commit_hold(p_hold_id bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status text;
BEGIN
  UPDATE credit_holds SET status = 'committed', settled_at = now()
   WHERE ledger_id = p_hold_id AND status = 'held';
  SELECT status INTO v_status FROM credit_holds WHERE ledger_id = p_hold_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commit_hold: no studio hold %', p_hold_id USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_status;
END $$;

-- refund_hold(hold_id) → the hold's status afterwards: 'refunded' (credits back, now or before —
-- a second call is a no-op), or 'committed' (final, no refund). Unknown hold_id: error no_data_found.
-- Exactly once twice over: the held → refunded transition, and the unique (job_id, reason) index on
-- the 'studio_refund' ledger row.
CREATE FUNCTION refund_hold(p_hold_id bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status text;
BEGIN
  UPDATE credit_holds SET status = 'refunded', settled_at = now()
   WHERE ledger_id = p_hold_id AND status = 'held';
  IF FOUND THEN
    INSERT INTO credit_ledger (user_id, delta, reason, job_id)
      SELECT user_id, -delta, 'studio_refund', job_id FROM credit_ledger WHERE id = p_hold_id
      ON CONFLICT DO NOTHING;
  END IF;
  SELECT status INTO v_status FROM credit_holds WHERE ledger_id = p_hold_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_hold: no studio hold %', p_hold_id USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_status;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Users without secrets (no emails, phones, password hashes: those live in auth_* tables, which
-- stay closed). The column list is the allow-list: a new users column is not exposed by itself.
-- created_at is unix seconds, as in users.
-- ---------------------------------------------------------------------------------------------
CREATE VIEW users_public AS SELECT id, display_name, status, created_at FROM users;

-- ---------------------------------------------------------------------------------------------
-- Grants. SECURITY DEFINER functions run as account_app, so they get a fixed search_path (this
-- schema, then pg_temp last so a caller's temporary table can never shadow a ledger table).
-- Functions are executable by PUBLIC by default: close every function here (the SQLite helpers from
-- 0001 included), then open exactly the three holds to studio_app.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  s text := quote_ident(current_schema());
BEGIN
  EXECUTE format('ALTER FUNCTION hold_credits(text, bigint, text) SET search_path = %s, pg_temp', s);
  EXECUTE format('ALTER FUNCTION commit_hold(bigint) SET search_path = %s, pg_temp', s);
  EXECUTE format('ALTER FUNCTION refund_hold(bigint) SET search_path = %s, pg_temp', s);
  EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %s FROM PUBLIC', s);

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %s TO studio_app', s);
    GRANT EXECUTE ON FUNCTION hold_credits(text, bigint, text), commit_hold(bigint), refund_hold(bigint) TO studio_app;
    GRANT SELECT ON users_public TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_ro') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %s TO reporting_ro', s);
    GRANT SELECT ON users_public TO reporting_ro;
  END IF;
END $$;

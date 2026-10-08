-- Background jobs such as inbox replies must not use up a seller's parallel slots for
-- video work. Only jobs with counts_toward_limit = 1 count against the plan limit.
ALTER TABLE jobs ADD COLUMN counts_toward_limit INTEGER NOT NULL DEFAULT 1 CHECK (counts_toward_limit IN (0, 1));

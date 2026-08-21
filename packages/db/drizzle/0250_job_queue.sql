-- The Postgres job queue and its lease primitive.
--
-- This table replaces Redis as the substrate the background tier runs on. It
-- lives in the TENANT database, which is what makes the queue per-tenant: there
-- is no shared queue to route out of, and a job enqueued for one tenant is not
-- reachable from another's connection. The `tenant_id` column is a second,
-- independent statement of the same fact, asserted at claim time so a row that
-- somehow arrived in the wrong database is refused loudly rather than executed
-- (a wrong-tenant answer does not throw on its own).
--
-- ## Why a lease and not just SKIP LOCKED
--
-- `FOR UPDATE SKIP LOCKED` releases the instant the claiming transaction
-- commits. Holding a row through a multi-minute AI call or an export build
-- would mean holding a transaction open for minutes, which pins vacuum and
-- burns a pooler slot. `help-center-translate` already needs a 120s lock today.
--
-- So the claim is a SHORT transaction that flips `pending -> running` and
-- stamps `locked_until` + `lease_token`; the work then runs with NO transaction
-- open, extending `locked_until` by heartbeat; and a reaper reclaims leases
-- whose owner died.
--
-- ## The dangerous part: `attempts` is incremented AT CLAIM
--
-- `import` and `export` deliberately run with one attempt, because a retry
-- would double-import a customer's data. A reaper that returned every expired
-- lease to `pending` would silently convert "this job must run at most once"
-- into "this job runs again whenever a process dies mid-work".
--
-- Incrementing `attempts` in the claim itself is what makes at-most-once
-- expressible: a job with `max_attempts = 1` that was claimed even once already
-- has `attempts = 1`, so the reaper's own predicate (`attempts >= max_attempts`
-- -> terminal `failed`) refuses to hand it back. Incrementing on completion
-- instead would leave a killed job at `attempts = 0` and re-run it, which is
-- exactly the defect this comment exists to prevent. Do not move it.
CREATE TABLE IF NOT EXISTS "job_queue" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- App-facing branded id ('job_...'), stable across attempts so logs correlate.
  "job_id" text NOT NULL,
  -- Logical queue name, e.g. 'anon-sweep'. Maps to one registered handler.
  "queue" text NOT NULL,
  -- Idempotency handle. A cron slot writes '<queue>:<slot ISO>' here, so two
  -- schedulers racing the same tick produce one row, enforced by the database
  -- rather than by a lock.
  "dedupe_key" text,
  -- The tenant this row was enqueued for, or NULL on a single-tenant install.
  -- Asserted at claim time; see the module header.
  "tenant_id" text,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  -- Earliest instant the job may be claimed. Delays and retry backoff both
  -- move this forward.
  "run_at" timestamptz NOT NULL DEFAULT now(),
  -- Incremented BY THE CLAIM, never by completion. See the module header.
  "attempts" integer NOT NULL DEFAULT 0,
  -- 1 means at-most-once: an expired lease goes terminal, never back to pending.
  "max_attempts" integer NOT NULL DEFAULT 1,
  -- Fencing token, regenerated on every claim. Every subsequent write to the
  -- row is guarded by it, so a process that resumes after its lease was reaped
  -- cannot overwrite the new owner's state.
  "lease_token" uuid,
  "locked_until" timestamptz,
  "locked_by" text,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "finished_at" timestamptz,
  CONSTRAINT "job_queue_status_check"
    CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed')),
  CONSTRAINT "job_queue_max_attempts_check" CHECK ("max_attempts" >= 1),
  -- A running row must carry a lease; a pending row must not. Without this the
  -- reaper's predicate could be satisfied by a NULL `locked_until`, which reads
  -- as "expired" under any comparison you write.
  CONSTRAINT "job_queue_lease_shape_check" CHECK (
    ("status" = 'running') = ("lease_token" IS NOT NULL AND "locked_until" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "job_queue_job_id_idx" ON "job_queue" ("job_id");

-- Idempotency across ALL statuses, deliberately. A cron slot that already ran
-- (or already failed) must not be re-enqueued by a later tick; the slot is
-- spent. Retention prunes terminal rows far older than any slot a scheduler
-- will emit, so the key can never be recycled while it still means something.
CREATE UNIQUE INDEX IF NOT EXISTS "job_queue_dedupe_idx"
  ON "job_queue" ("queue", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;

-- The claim path: pending rows for one queue, oldest runnable first.
CREATE INDEX IF NOT EXISTS "job_queue_claim_idx"
  ON "job_queue" ("queue", "run_at", "id")
  WHERE "status" = 'pending';

-- The reaper path: running rows whose lease has lapsed.
CREATE INDEX IF NOT EXISTS "job_queue_lease_idx"
  ON "job_queue" ("locked_until")
  WHERE "status" = 'running';

-- The retention path: terminal rows by age.
CREATE INDEX IF NOT EXISTS "job_queue_terminal_idx"
  ON "job_queue" ("finished_at")
  WHERE "status" IN ('succeeded', 'failed');

COMMENT ON TABLE "job_queue" IS
  'Postgres-backed background job queue with leases. Per-tenant by construction: the table lives in the tenant database.';
COMMENT ON COLUMN "job_queue"."attempts" IS
  'Incremented by the CLAIM, never by completion. This is what makes max_attempts=1 mean at-most-once across a process death.';
COMMENT ON COLUMN "job_queue"."lease_token" IS
  'Fencing token. Every write after the claim is guarded by it, so a reaped owner cannot overwrite its successor.';

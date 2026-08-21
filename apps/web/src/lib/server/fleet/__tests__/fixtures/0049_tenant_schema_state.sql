-- Fleet migration intent (SAAS-HOSTING-STACK.md §10.3).
--
-- Under pooled compute one code version serves tenants on two schema versions
-- for the duration of every rollout. `deploy.preDeployCommand` cannot migrate
-- them: it runs once per deploy, not once per tenant, and making it iterate
-- would put a multi-hour fleet migration on the deploy critical path.
--
-- So the control plane records INTENT and the app RECONCILES toward it. This
-- table is the intent. It holds no SQL, no migration content and no schedule —
-- the migrations are bundled in the app image (`packages/db/drizzle`), which is
-- what stops version affinity from having to be maintained by hand across two
-- repositories. What lives here is: which tenants should be at which version,
-- what happened last time, and the lease that stops two migrator replicas
-- working the same tenant.
--
-- ## Why it carries a lease and not just a status
--
-- Claiming is `FOR UPDATE SKIP LOCKED` + lease — the same primitive the job
-- queue already requires (§7.2), because the row lock released by SKIP LOCKED
-- vanishes the instant the claiming transaction commits, and a tenant migration
-- is minutes of work outside any transaction. The columns below are therefore
-- deliberately the same shape as the tenant-side `job_queue`: one set of
-- statements drives both, so the at-most-once proof done on that table is the
-- proof for this one. Do not "simplify" the shape; the shape IS the reuse.
--
-- ## The three columns that are not the lease
--
--   target_version   what the CP wants. A journal `when` millis, so it is
--                    orderable and directly comparable with what the tenant
--                    database's own drizzle ledger reports.
--   current_version  what was last OBSERVED in the tenant database, written
--                    only after a run whose post-conditions were verified
--                    against the catalogue. Never written from the ledger
--                    alone: a run killed in the tail leaves a complete ledger
--                    and a broken database.
--   cohort           the rollout unit (§10.8): canary, then ~5%, then fleet.
--                    A claim narrows on it, so halting a rollout is a
--                    single-row update rather than a deploy.
--
-- ## Expand/contract
--
-- This migration is additive only: one new table, no change to any existing
-- one. A control plane running the previous code ignores it entirely, which is
-- the ordering rule (§10.1) applied to the control plane's own schema.

CREATE TABLE "cp_tenant_schema_state" (
  -- Surrogate identity, matching job_queue, because the lease statements fence
  -- on `id`. tenant_id is the natural key and is unique below.
  "id"               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id"        text NOT NULL
                       REFERENCES "cp_tenant_registry"("tenant_id") ON DELETE CASCADE,

  -- ── Intent ────────────────────────────────────────────────────────────────
  -- Journal `when` millis of the newest migration the fleet should have applied
  -- to this tenant. Written by the control plane; never by the migrator.
  "target_version"   bigint NOT NULL,
  "cohort"           text NOT NULL DEFAULT 'default',

  -- ── Observation ───────────────────────────────────────────────────────────
  -- Written by the migrator only after a verified run. NULL means "never
  -- successfully reconciled by this mechanism", which is different from
  -- "behind" and must not be read as either up-to-date or as a version 0.
  "current_version"  bigint,
  -- Rows in drizzle.__drizzle_migrations at that moment. Diagnostic only: it is
  -- the number that reads plausible while the database is wrong, so it is
  -- recorded next to the post-condition verdict rather than instead of it.
  "applied_count"    integer,
  -- The catalogue-verified verdict. FALSE with a complete ledger is the exact
  -- state §10.2 warns about, and it is representable here on purpose.
  "postconditions_ok" boolean,
  "last_verified_at" timestamptz,

  -- ── Lease (same shape as job_queue; see the header) ───────────────────────
  -- `text` with a CHECK, not an enum, and that is not a style preference. The
  -- lease statements are shared verbatim with `job_queue`, whose reaper writes
  -- `CASE WHEN … THEN 'pending' ELSE 'failed' END`. Against an enum column that
  -- CASE yields `text` and Postgres refuses the assignment, so an enum here
  -- would force a cast into the shared statement — and a cast naming THIS
  -- table's type is a second implementation wearing the first one's name.
  -- Measured, not predicted: the enum version failed on the first real reaper
  -- pass with "column status is of type tenant_schema_status but expression is
  -- of type text".
  "status"           text NOT NULL DEFAULT 'pending',
  "run_at"           timestamptz NOT NULL DEFAULT now(),
  -- Incremented BY THE CLAIM, never by completion. A migrator killed mid-run
  -- has already spent an attempt, so a crash loop against one poisonous tenant
  -- terminates instead of waking its Neon compute forever.
  "attempts"         integer NOT NULL DEFAULT 0,
  "max_attempts"     integer NOT NULL DEFAULT 3,
  -- Fencing token, regenerated on every claim. A migrator that stalls past its
  -- lease, is reaped, then finishes and reports success updates zero rows.
  "lease_token"      uuid,
  "locked_until"     timestamptz,
  "locked_by"        text,
  "last_error"       text,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  "started_at"       timestamptz,
  "finished_at"      timestamptz,

  -- One intent row per tenant. Two rows would let two cohorts disagree about
  -- one tenant with nothing to adjudicate them.
  CONSTRAINT "cp_tenant_schema_state_tenant_uk" UNIQUE ("tenant_id"),

  -- pending  claimable
  -- running  leased by a migrator
  -- succeeded reconciled AND post-conditions verified
  -- failed    terminal; attempts exhausted, or a diagnosis a retry cannot fix
  -- blocked   deliberately excluded from claiming (a halted rollout, a tenant
  --           under investigation). Never reached by the reaper, which only
  --           looks at `running`.
  CONSTRAINT "cp_tenant_schema_state_status_ck"
    CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed', 'blocked')),
  CONSTRAINT "cp_tenant_schema_state_max_attempts_ck" CHECK ("max_attempts" >= 1),
  CONSTRAINT "cp_tenant_schema_state_cohort_ck" CHECK (btrim("cohort") <> ''),
  CONSTRAINT "cp_tenant_schema_state_target_ck" CHECK ("target_version" > 0),
  CONSTRAINT "cp_tenant_schema_state_current_ck"
    CHECK ("current_version" IS NULL OR "current_version" > 0),

  -- A running row must carry a lease; a non-running row must not. Without this
  -- the reaper's predicate is satisfiable by a NULL locked_until, which reads
  -- as "expired" under any comparison you write.
  CONSTRAINT "cp_tenant_schema_state_lease_shape_ck" CHECK (
    ("status" = 'running') = ("lease_token" IS NOT NULL AND "locked_until" IS NOT NULL)
  ),

  -- A success claim has to carry its evidence. Recording `succeeded` with no
  -- observed version and no verdict would make the table agree with exactly the
  -- failure it exists to catch.
  --
  -- `current_version >= target_version` is the third clause and it closes a real
  -- hole rather than restating the others: a migrator whose bundled lineage is
  -- OLDER than the target the control plane wrote would otherwise apply
  -- everything it has, observe a version below the target, and record
  -- `succeeded` — a tenant reported reconciled to a version the image running
  -- the migration had never heard of. It is also unclaimable in that state,
  -- because the claim narrows on `current_version < target_version`, so the
  -- rollout would report complete having skipped it. Found by a test rather
  -- than by reasoning: the "re-claim after the target moves" case went green
  -- only because the row had quietly become unreachable.
  CONSTRAINT "cp_tenant_schema_state_success_evidence_ck" CHECK (
    "status" <> 'succeeded'
    OR ("current_version" IS NOT NULL
        AND "current_version" >= "target_version"
        AND "postconditions_ok" IS TRUE
        AND "last_verified_at" IS NOT NULL)
  ),

  -- A terminal failure has to say why. "failed, reason unknown" is a support
  -- ticket by construction, and this is the row an operator reads at 3am.
  CONSTRAINT "cp_tenant_schema_state_failure_reason_ck" CHECK (
    "status" <> 'failed' OR btrim(coalesce("last_error", '')) <> ''
  )
);--> statement-breakpoint

-- The claim path: claimable rows, oldest runnable first, narrowed by cohort.
CREATE INDEX "cp_tenant_schema_state_claim_idx"
  ON "cp_tenant_schema_state" ("cohort", "run_at", "id")
  WHERE "status" = 'pending';--> statement-breakpoint

-- The reaper path: running rows whose lease has lapsed.
CREATE INDEX "cp_tenant_schema_state_lease_idx"
  ON "cp_tenant_schema_state" ("locked_until")
  WHERE "status" = 'running';--> statement-breakpoint

COMMENT ON TABLE "cp_tenant_schema_state" IS
  'Fleet migration intent. The control plane writes target_version and cohort; the app image reconciles toward it and writes back only verified observations.';--> statement-breakpoint
COMMENT ON COLUMN "cp_tenant_schema_state"."attempts" IS
  'Incremented by the CLAIM, never by completion — so a migrator killed mid-run has already spent an attempt and a poisonous tenant cannot loop forever.';--> statement-breakpoint
COMMENT ON COLUMN "cp_tenant_schema_state"."postconditions_ok" IS
  'Catalogue-verified, never derived from drizzle.__drizzle_migrations. A run killed after migrate() leaves a complete ledger and an invalid index; this column is where that shows.';--> statement-breakpoint

-- updated_at maintained by the database, not by the writer, so a hand-run
-- UPDATE during an incident is still visible as a change.
CREATE OR REPLACE FUNCTION "cp_tenant_schema_state_touch"() RETURNS trigger AS $fn$
BEGIN
  NEW."updated_at" := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "cp_tenant_schema_state_touch_trg"
  BEFORE UPDATE ON "cp_tenant_schema_state"
  FOR EACH ROW EXECUTE FUNCTION "cp_tenant_schema_state_touch"();

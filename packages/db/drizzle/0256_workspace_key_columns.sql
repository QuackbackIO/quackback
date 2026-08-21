-- The scope column is named for what it is: a workspace key.
--
-- Every table below carries the identifier of the workspace whose data the row
-- belongs to. It was called `tenant_id`, which named the entity by the word the
-- rest of the product had already stopped using, and -- worse for the one place
-- it matters -- invited confusion with `settings.id`, the workspace's own
-- primary key. Those are two different identifiers with two different authors
-- (SAAS-HOSTING-STACK.md section 3), and the fingerprint gate depends on nobody
-- mistaking one for the other.
--
-- So the column is `workspace_key`: the key naming WHICH workspace, assigned by
-- the control plane, `'_'` where there is only one. `settings.id` keeps `id`.
-- `settings.cloud_tenant_id` becomes `cloud_workspace_key` for the same reason
-- and with the same meaning: it holds the control plane's claim, not the
-- database's self-report.
--
-- ## Renamed in place rather than expanded and contracted
--
-- Section 10 requires expand/contract for anything a running older build
-- addresses. Nothing older addresses these. `job_queue` arrives in 0250, the
-- kv, presence and overflow tables in 0251, and `settings.cloud_tenant_id` in
-- 0255 -- none of which exist on `main` or `next`, so no release carries them
-- and no self-hosted install has ever run them. The only databases holding
-- these columns are the pooled fleet's, and the fleet migrator rolls them with
-- the build that reads the new names.
--
-- Renaming a column carries its constraints and indexes with it: Postgres
-- stores them against the attribute, not the name. `kv_store_pkey`,
-- `presence_stream_agents_idx` and the rest keep their names and their
-- definitions follow automatically. None of those names contains the old word.
--
-- ## Why the renames are guarded
--
-- `ALTER TABLE ... RENAME COLUMN` has no `IF EXISTS` spelling, so on its own it
-- is the one thing this lineage may not contain: a statement that fails on a
-- second run. The fleet migrator replays history -- its gap-heal truncates the
-- ledger to before the earliest missing entry and runs forward against a
-- database that already carries the effects -- so an unguarded rename here
-- would abort every heal of a workspace that spans this migration, permanently,
-- with the ledger rows already withdrawn and nothing able to write them back.
--
-- The guard is what makes it replay-safe: each rename fires only while the old
-- column is still there, and is skipped once it is not. `to_regclass` resolves
-- the table through the same `search_path` the unqualified `ALTER TABLE` below
-- it uses, so the guard and the statement it guards can never disagree about
-- which table they mean, and it yields NULL (rather than raising) on a database
-- where the table does not exist at all.
--
-- The DDL inside the guard is written out literally, never through
-- `EXECUTE format(...)`. Dynamic SQL would hide these renames from the
-- destructive-DDL scanner, which reads inside dollar-quoted blocks on purpose;
-- the point of the annotation below is to declare what this migration does, not
-- to smuggle it past the thing that reports it.
--
-- ## The one column a replay can resurrect
--
-- `settings.cloud_workspace_key` gets a third branch the others do not need.
-- The five kv tables and `job_queue` were created by `CREATE TABLE IF NOT
-- EXISTS`, which Postgres skips on the relation name alone, so replaying 0250
-- or 0251 cannot bring an old column back. `settings.cloud_tenant_id` came from
-- an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in 0255, and that DOES come
-- back: a heal that replays the span from 0249 runs 0255 again, re-adding the
-- old column a few statements before this one.
--
-- So the state to converge is "both names present", and the resurrected column
-- is empty by construction -- `ADD COLUMN` with no default writes NULLs, and no
-- code has referenced the old name since this branch. Dropping it is what makes
-- the pair 0255-then-0256 idempotent, which is the property the whole replay
-- model rests on.
--
-- @contract: safe-after 0.13.1

-- @replay: guarded-by each column's old name still existing; once the new name is the only one, every branch here is a no-op
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('kv_store') AND attname = 'tenant_id' AND NOT attisdropped) THEN
    ALTER TABLE "kv_store" RENAME COLUMN "tenant_id" TO "workspace_key";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('rate_bucket') AND attname = 'tenant_id' AND NOT attisdropped) THEN
    ALTER TABLE "rate_bucket" RENAME COLUMN "tenant_id" TO "workspace_key";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('kv_set_member') AND attname = 'tenant_id' AND NOT attisdropped) THEN
    ALTER TABLE "kv_set_member" RENAME COLUMN "tenant_id" TO "workspace_key";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('presence_stream') AND attname = 'tenant_id' AND NOT attisdropped) THEN
    ALTER TABLE "presence_stream" RENAME COLUMN "tenant_id" TO "workspace_key";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('realtime_overflow') AND attname = 'tenant_id' AND NOT attisdropped) THEN
    ALTER TABLE "realtime_overflow" RENAME COLUMN "tenant_id" TO "workspace_key";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('job_queue') AND attname = 'tenant_id' AND NOT attisdropped) THEN
    ALTER TABLE "job_queue" RENAME COLUMN "tenant_id" TO "workspace_key";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('settings') AND attname = 'cloud_tenant_id' AND NOT attisdropped) THEN
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('settings') AND attname = 'cloud_workspace_key' AND NOT attisdropped) THEN
      ALTER TABLE "settings" DROP COLUMN IF EXISTS "cloud_tenant_id";
    ELSE
      ALTER TABLE "settings" RENAME COLUMN "cloud_tenant_id" TO "cloud_workspace_key";
    END IF;
  END IF;
END $$;--> statement-breakpoint

COMMENT ON COLUMN "settings"."cloud_workspace_key" IS
  'Control-plane workspace key claiming this database. NULL on self-hosted installs. Read on pool checkout by the pooled fleet; never rendered to a client.';--> statement-breakpoint

COMMENT ON COLUMN "job_queue"."workspace_key" IS
  'Which workspace this job belongs to. Restates, as data, the boundary the connection already implies, so a claim can assert it rather than assume it.';--> statement-breakpoint

-- Moved here from 0257, on the far side of the rename. See the note there: a
-- `CREATE INDEX IF NOT EXISTS` naming a column resolves that column before it
-- checks the index name, so this statement cannot live before the rename and
-- still survive a replay. Here it is skipped on the index name on every second
-- run, and the column it names exists in both the fresh and the already-renamed
-- world by the time it runs.
CREATE INDEX IF NOT EXISTS "presence_stream_agents_idx"
  ON "presence_stream" ("workspace_key", "heartbeat_at") WHERE "is_agent";


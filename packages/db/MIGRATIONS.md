# Writing a migration

Migrations are SQL, written by hand in `drizzle/NNNN_<tag>.sql` with an entry in
`drizzle/meta/_journal.json`. Never run `db:generate`. Take the next free number
when the PR merges, not when you start.

The whole lineage of pending migrations runs in **one transaction**, so a
statement that scans or rewrites a big table holds its lock, and every lock taken
before it, for as long as the scan takes. A self-hosted boot waits at most
30 seconds for a lock (`DEFAULT_MIGRATE_LOCK_TIMEOUT_MS`, the same value the
fleet migrator uses); a migration that needs longer stops the boot with a lock
timeout error, changes nothing, and the next start tries again.

## The rule

`conversations`, `tickets`, `conversation_messages` and `events` are the large
tables. `src/__tests__/migration-rule.test.ts` enforces this rule on every
numbered migration; migrations that predate it are listed there and the list only
shrinks.

1. **Numbered migrations hold DDL**, and data changes only on small config tables
   (roles, ticket types, ticket statuses, workflows).
2. **A data change on a large table is a startup backfill**, never an `UPDATE` in a
   migration. Register it in `apps/web/src/lib/server/backfills/registry.ts`: it
   walks the table by `id` in short transactions after the server listens, keeps
   its cursor in kv and retries until it is done. Its readers must work on rows it
   has not reached yet.
3. **Indexes on a large table are never built in a migration.** An index a boot or
   hot read needs goes in `CONCURRENT_INDEX_SPECS` (built before the server
   listens). Every other index goes in `DEFERRED_INDEX_SPECS`: the
   `deferred-index-build` job builds it after the server listens, one job per
   index, and its readers work, slower, until then. Say so on the entry, and list
   the index work in the release note.
4. **Constraints on a large table do not scan it.** A foreign key on a new column is
   written inline, which Postgres does not check for a new column with no default,
   and a replay is a no-op:

   ```sql
   ALTER TABLE tickets ADD COLUMN IF NOT EXISTS merged_into_id uuid
     REFERENCES tickets(id) ON DELETE SET NULL;
   ```

   Any other foreign key, and every check (also on a new column: an inline check
   scans the table), is added `NOT VALID` inside a guard, with the replay note
   directly above it. Validate it later, outside the migration transaction.

   ```sql
   -- @replay: guarded-by the constraint name in pg_constraint
   DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_kind_ck') THEN
       ALTER TABLE tickets ADD CONSTRAINT tickets_kind_ck CHECK (kind IN ('a', 'b')) NOT VALID;
     END IF;
   END $$;
   ```

5. **Every person column on a large table gets an index.** A column that references
   `principal` makes each principal delete (the sign-in merge of an anonymous
   visitor, the daily anonymous sweep, a merge, an erase) scan the table for
   `ON DELETE`, unless an index leads with it. Add a partial index
   `(column) WHERE column IS NOT NULL` to `DEFERRED_INDEX_SPECS`, as
   `conversation_messages_deleted_by_principal_idx` does in the schema.
6. **On other tables, a check on a new column is written inline** on the column
   (`ADD COLUMN IF NOT EXISTS x text CHECK (...)`), and foreign keys inline in
   `CREATE TABLE IF NOT EXISTS`, so the file replays as a no-op. A bare
   `ALTER TABLE ... ADD CONSTRAINT` is refused by the replay-safety gate.
7. **The newest migrations stay safe to replay.** A data change or a guarded
   constraint goes in a `DO $$` block with a `-- @replay: guarded-by <reason>` line
   directly above it (see `0308_remove_approvals_leftovers.sql`). A bare `UPDATE`,
   a bare `DO` block and `SET NOT NULL` are refused. At least the newest 3
   migrations must be safe at every merge.
8. **A backfill or reconcile that updates `tickets` keeps `updated_at`.** The "recent"
   ticket list, search ranking, the REST `updatedAfter` sync and the retention clock
   read it. A Drizzle update sets ``updatedAt: sql`${tickets.updatedAt}` `` (the
   column's `$onUpdate` would otherwise bump it); raw SQL leaves the column out of
   `SET`. Every registered backfill supplies a fixture that seeds rows its step must
   change and returns the check of the result; the shared backfill test runs it
   and checks that `updated_at` did not move.

## The schema floor

A new build migrates a workspace to its own bundled migrations before it serves
it. `MIN_SCHEMA_VERSION`, the Cloud web tier's floor, is a deploy setting the
fleet sets per roll: no PR changes it.

A Cloud worker can still roll before a workspace has migrated, so every new job
and backfill names the migration it needs (`requiresMigration`). The schedule
pass does not enqueue it for a workspace whose ledger lacks that migration, and a
job that still meets a missing migration throws, so the queue retries it rather
than failing it for good (`apps/web/src/lib/server/backfills/schema-floor.ts`).

## Heavy jobs

A new job that walks a large table, builds an index or runs in every workspace
sets `fleetConcurrency` (2 to 4) and `retryBackoffMs`. See the fleet cap rule in
`apps/web/src/lib/server/jobs/JOBS.md` §10.

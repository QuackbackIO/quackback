# @quackback/db

Drizzle ORM schema, hand-written SQL migrations, and the seed/reset tooling.

## The migration contract

**Migrations are hand-written SQL.** Every file in `drizzle/*.sql` is authored
by hand, and `drizzle/meta/_journal.json` is maintained by hand to match. The
journal entry order is what the runtime migrator executes, and each entry's
`tag` must equal the SQL filename without the extension.

**Never run `drizzle-kit generate`** (or `bun run db:generate`). The snapshot
history in `drizzle/meta` stopped at migration 0052 and is historical only;
the generator would diff against that stale snapshot and produce garbage. The
`db:generate` script remains only because removing it does not undo the stale
snapshots; treat it as a trap, not a tool.

**Adding a schema change** always means two edits that must land together:

1. A new SQL migration in `drizzle/`, numbered with the next free number
   (current highest + 1, zero-padded to four digits), plus a matching entry
   appended to `drizzle/meta/_journal.json` (`idx` = previous + 1, `tag` =
   filename without `.sql`).
2. The corresponding change to the TypeScript schema in `src/schema/`.

The drift check (below) is the enforcement: CI fails when the SQL and the TS
schema stop describing the same database.

## The drift check

```bash
bun run db:check-drift          # from packages/db (or the repo root)
```

What it does:

1. Drops and recreates a scratch database (`quackback_drift_check`) on a local
   postgres server (default `postgresql://postgres:password@localhost:5432/postgres`,
   override with `DRIFT_CHECK_DATABASE_URL`; the URL's database is only used
   for `CREATE/DROP DATABASE`).
2. Applies every migration with the same drizzle-orm migrator production uses.
3. Diffs the resulting live schema against `src/schema` via drizzle-kit's
   programmatic push API and fails on any statement the diff would emit.

The scratch database is always dropped afterwards, including on failure.

Legitimately SQL-only DDL (the `page_views` partitioning, partition children,
the raw-SQL `sweep_lock` table, known drizzle-kit introspection false
positives) is covered by the explicit exemption list in
`scripts/check-drift.ts`. Every exemption carries a reason, and an exemption
that stops matching anything fails the check so the list cannot rot.

drizzle-kit introspection cannot see partitioned parent tables, so the checker
verifies `page_views` separately: a direct catalog comparison of the parent's
live columns and indexes against the TS declaration (partition children stay
exempt; they inherit the parent's schema).

Quirks the schema files inherit from the checker (all commented in place):
multi-column UNIQUE constraints and composite primary keys are declared in
alphabetical column order because that is how drizzle-kit introspects them;
constraint names are declared explicitly wherever the migration's name differs
from drizzle's generated one (including pg's 63-char truncations); DESC index
columns carry `.nullsFirst()` to match postgres's default for plain `DESC`.

## Long-lived dev databases can silently skip migrations

Drizzle's migrator records a single high-water mark (the created-at timestamp
of the last applied entry), not a per-file ledger. If a migration is inserted
or renumbered mid-sequence after your dev database already passed that point,
`db:migrate` will silently skip it: the database looks migrated but is missing
DDL. Fresh databases (CI, new installs) are unaffected.

Detection: compare the files against what actually ran, e.g. spot-check that
objects from recent migrations exist, or hash-compare `drizzle/*.sql` against
the `drizzle.__drizzle_migrations` ledger. Fix: apply the missing DDL manually
with psql (never by re-running `db:migrate`, which cannot help), or reset the
database if the data is disposable.

## Everyday commands

```bash
bun run db:migrate       # apply migrations + seed system data
bun run db:seed          # demo/sample data
bun run db:reset         # drop + recreate + migrate + seed
bun run db:check-drift   # prove SQL migrations == TS schema
```

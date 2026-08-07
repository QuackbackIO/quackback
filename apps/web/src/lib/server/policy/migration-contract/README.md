# Migration contract linter

A regression harness that pins **which hand-written SQL migrations carry
destructive DDL**, and fails CI when a new one ships without an explicit
sign-off naming the release it's safe after. It exists because Quackback is
moving from one-pod-per-tenant (where code and schema always ship together,
so a breaking migration is safe) to a pooled fleet, where **one code version
serves tenants on two schema versions for the duration of every rollout**
(see `SAAS-HOSTING-STACK.md` §10). A `DROP COLUMN` that ships in the same
release as the code that stops reading it takes down every tenant still on
the old schema.

The discipline this enforces is **expand/contract**: additive change ships
with the release that needs it; destructive change ships at least one
release _later_, once no running code references the old shape.

The generated, reviewable output is [`CONTRACT.md`](./CONTRACT.md). It is the
structural sibling of [`../dep-graph`](../dep-graph) and
[`../authz-matrix`](../authz-matrix): snapshot-what-is, fail on an
unreviewed diff.

## The annotation

A migration with destructive DDL needs one comment line anywhere in the file:

```sql
-- @contract: safe-after 0.14.0
ALTER TABLE posts DROP COLUMN legacy_slug;
```

A trailing rationale is allowed and encouraged:

```sql
-- @contract: safe-after 0.14.0   (column unreferenced since 0.14.0)
ALTER TABLE posts DROP COLUMN legacy_slug;
```

**The annotation covers the whole file, not just the statement below it.** A
migration file is already the atomic deploy/review unit — drizzle's journal
applies them one at a time, in order — so one contract claim for the file is
the natural grain. If a migration bundles destructive changes that
genuinely become safe at different releases, split it into separate
migration files rather than writing two annotations in one file; the linter
does not thread an annotation to a specific statement.

The linter does not verify that the named release has actually shipped, or
that old code has actually stopped referencing the shape — that is the
judgment call the annotation records, not something static analysis can
check. It exists to force the question to be asked and the answer to be
written down, not to adjudicate it.

## What counts as destructive

Detected, at minimum per the brief, plus one addition:

| DDL                                        | Why it breaks a still-running old code version                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DROP COLUMN`                              | A read or write against the column errors immediately.                                                                                                                                                                                                                                                                               |
| `DROP TABLE`                               | Same, for the whole table.                                                                                                                                                                                                                                                                                                           |
| `DROP CONSTRAINT`                          | Required by the brief; also matches every historical instance, which drops an FK alongside a column it referenced.                                                                                                                                                                                                                   |
| `RENAME COLUMN`                            | The name old code addresses no longer resolves.                                                                                                                                                                                                                                                                                      |
| `ALTER TABLE ... RENAME TO` (table rename) | Same, for the table name.                                                                                                                                                                                                                                                                                                            |
| `ALTER COLUMN ... SET NOT NULL`            | Old code that legitimately wrote `NULL` (valid under the old schema) starts failing writes.                                                                                                                                                                                                                                          |
| `ALTER COLUMN ... [SET DATA] TYPE`         | Flagged unconditionally, not just on "narrowing" — see below.                                                                                                                                                                                                                                                                        |
| `ALTER COLUMN ... DROP DEFAULT`            | Old code that omits the column on INSERT (relying on the default that used to fill it) starts failing NOT NULL writes. Not in the brief's minimum list, but called out there as an example, and has a real historical instance (`0125_conversation_channel_drop_default.sql`) whose own comment documents exactly this failure mode. |

**Type changes are flagged unconditionally, not just "narrowing" ones.**
Telling a widening change (`varchar(50)` → `varchar(255)`) from a narrowing
one (`text` → `varchar(50)`, or a pgvector dimension change) requires real
type-lattice knowledge — precision, scale, enum membership, vector
dimensions — that a static line-based scanner cannot safely infer. Both
historical instances change a pgvector column's dimension, a hard break for
old code with the old dimension baked in. Over-flagging a genuinely safe
widening costs a one-line annotation; under-flagging a real narrowing ships
an outage.

## What's deliberately not detected, and why

- **`DROP INDEX`** — a performance concern, not a correctness one. Both code
  versions keep running correctly; the query just gets slower. "An index a
  query plan depends on" can't be told apart from any other index by static
  analysis — nearly every index matters to _some_ query — so flagging
  `DROP INDEX` would flag close to all of them, which is noise, not signal.
- **`ADD CONSTRAINT ... CHECK`** — the genuinely risky shape (a CHECK added
  to an already-populated column with no backfill and no `NOT VALID`) is
  indistinguishable, by static analysis, from the safe shapes a CHECK
  addition takes throughout this codebase's history: a brand-new table (no
  existing rows to violate it), a same-migration
  add-column-then-backfill-then-constrain sequence (the backfill already ran
  by the time the constraint takes effect), or a constraint that's a
  widening superset of an invariant the table already enforced (verified by
  hand: 12 historical files add a `CHECK` against a table that already
  existed; every one of them is one of these three safe shapes — several say
  so directly in their own migration comments). Flagging all of them to
  guard against a shape that doesn't currently occur would fail the
  precision bar this linter is judged on. If you're adding a CHECK to an
  existing, populated column with no in-migration backfill and no argument
  for why every existing row already satisfies it, use Postgres's
  `NOT VALID` + a later `VALIDATE CONSTRAINT` — that pattern is itself
  expand/contract-safe and is the right tool for this case, just not one
  this linter gates.
- **`RENAME CONSTRAINT`** / **`ALTER INDEX ... RENAME TO`** — constraint and
  index names are not addressed by ordinary application code or the ORM
  (only by name in rare cases like `ON CONFLICT ON CONSTRAINT`). Renaming
  one is invisible to running code. `0127_conversation_tags_rename.sql`
  renames 41 auto-generated constraint names for cosmetic
  consistency alongside genuine table renames; only the table renames are
  load-bearing, and only those are flagged.
- **`ALTER COLUMN ... DROP NOT NULL`, `SET DEFAULT`** — both loosen a
  constraint. Old code that worked under the tighter schema keeps working
  under the looser one.
- **Dynamic SQL built via `EXECUTE format('...')`** — the DDL lives inside a
  string literal to a static scanner. Same limitation the import-graph
  scanner (`../dep-graph`) accepts for a non-literal `import()` argument:
  it can't be resolved without executing the program.
- **Migration-execution safety** (e.g. `ADD COLUMN ... NOT NULL` with no
  default on a populated table, which fails outright rather than silently
  breaking old code) is out of scope. This linter is about _cross-version
  compatibility_, not whether a migration succeeds against real data —
  that's what running it against a Neon branch pre-flight (§10.8) is for.

## Grandfathering history

All 226 migrations in `packages/db/drizzle` were written before this linter
existed, under the old one-pod-per-tenant assumption where destructive
migrations were safe. Forcing them into churn (retroactively annotating 29
files, none of which are being re-shipped) would not make any tenant safer
— it would just be busywork. They're grandfathered wholesale in
[`grandfathered.ts`](./grandfathered.ts), a **hand-derived, frozen** list —
built by reading every migration, not by running the scanner and copying its
output (which would make the allowlist self-fulfilling and unable to ever
fail).

**If your new migration fails this check, the fix is to add the
annotation — never to add your migration's filename to `grandfathered.ts`.**
That file's own header says so, and `__tests__/ledger.test.ts` asserts the
real migration history has zero unannotated destructive DDL outside it, so
a PR that both adds a new destructive migration _and_ adds it to the
allowlist still shows up as a diff to `grandfathered.ts` for a reviewer to
question — the same trust model `../authz-matrix` uses for its
classifications.

## The CI gates

- **Blocking check** (`__tests__/ledger.test.ts`, "HARD RULE"): every
  migration with destructive DDL and no valid annotation must be in the
  frozen allowlist. A new one that isn't fails with the file, the specific
  findings, and their line numbers.
- **Malformed-annotation check**: a `-- @contract:` comment that doesn't
  parse (wrong keyword, missing or non-semver version) fails distinctly from
  a missing annotation, so a typo doesn't quietly pass as "not destructive"
  or silently land in the grandfathered bucket.
- **Allowlist hygiene**: an entry in `grandfathered.ts` that no longer needs
  grandfathering (someone annotated it retroactively) fails and names
  itself, so the list only ever shrinks toward the migrations that truly
  predate the linter.
- **Golden snapshot** (`__tests__/ledger.test.ts`): `CONTRACT.md` must match
  the live scan. Regenerate and review the diff like any other policy
  snapshot:

  ```bash
  bunx vitest run apps/web/src/lib/server/policy/migration-contract -u
  ```

  Unlike `../dep-graph` and `../authz-matrix`, **regenerating this snapshot
  is not itself a valid response to a new failure.** A `CONTRACT.md` diff
  that adds a new row without a matching `grandfathered.ts` change is
  exactly the situation the annotation exists to force — go add the
  comment to the migration, then regenerate.

- **Extraction tests** (`__tests__/scan.test.ts`): pin the DDL-detection and
  annotation-parsing rules on synthetic snippets, including the
  false-positive traps a naive `grep` would fall into — DDL-shaped words
  inside a `--` comment or a `'...'` string literal, an apostrophe inside an
  English comment, and DDL nested inside a `DO $$ ... $$` block.

## When you're blocked by this

1. You wrote (or generated) a migration with a `DROP COLUMN` / `DROP TABLE`
   / etc.
2. CI fails, naming the file and the specific destructive statement(s).
3. Ask: has every running code version stopped referencing the old shape?
   Under expand/contract, that's true only after the release that stops
   reading it has fully rolled out to the fleet — not the release that adds
   the drop.
   - **If yes** (you're intentionally cleaning up something already dead),
     add the annotation naming the release this is safe after, and land it.
   - **If no** (you're dropping something current code still reads), don't
     add the annotation to make CI pass — split the change: ship the code
     that stops referencing the old shape first, then the drop in a later
     release once the fleet has migrated.
4. Never add the new filename to `grandfathered.ts`. That list is frozen to
   pre-linter history.

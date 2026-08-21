# Migration contract linter

A regression harness that pins **which hand-written SQL migrations carry
destructive DDL**, and fails CI when a new one ships without an explicit
sign-off naming the release it's safe after. It exists because Quackback is
moving from one-pod-per-workspace (where code and schema always ship together,
so a breaking migration is safe) to a pooled fleet, where **one code version
serves workspaces on two schema versions for the duration of every rollout**.
A `DROP COLUMN` that ships in the same
release as the code that stops reading it takes down every workspace still on
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

The comment can also trail real DDL on the same line rather than stand alone
above it — both are recognized:

```sql
ALTER TABLE posts DROP COLUMN legacy_slug; -- @contract: safe-after 0.14.0
```

`safe-after 0.0.0` is rejected as malformed rather than accepted: it's
syntactically a version but not a real release, and a version nobody could
plausibly name a release makes for an unreviewable rubber stamp. Name the
actual release.

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

## The other annotation: `-- @replay: guarded-by`

`replay-safety.ts` answers a different question — _would running this migration
a second time change anything?_ — for the fleet migrator, whose gap-heal
truncates a ledger and replays the span forward against a database that already
carries the effects. It classifies each statement `safe`, `errors` or
`mutates`, and refuses only `mutates`.

A `DO $$ … $$` block is refused, because its body is opaque to the tokenizer and
could contain any write. That default is correct and is not going to be softened
by teaching the tokenizer plpgsql: `stripNoise` already has one known recall hole
around dollar-quoted text, and a deeper parser would deepen it.

The escape is an explicit claim instead, on the line above the statement:

```sql
-- @replay: guarded-by the old column still existing; the rename is skipped once it is gone
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('kv_store') AND attname = 'tenant_id' AND NOT attisdropped) THEN
    ALTER TABLE "kv_store" RENAME COLUMN "tenant_id" TO "workspace_key";
  END IF;
END $$;
```

`guarded-by` is a required literal and the rationale after it is required too:
what a reviewer has to check is _which_ guard, and an annotation that does not
say is not reviewable. This is the same reason `safe-after 0.0.0` is rejected.

Three things keep it a claim rather than a loophole:

- **It only reaches a `DO` block.** Above an `INSERT`, an `UPDATE` or anything
  else the classifier can read for itself, the file is refused _and_ the
  misplacement is reported by name. The annotation can never launder a write.
- **It is scoped to one statement**, unlike `@contract`, which covers the file.
  It has to sit in the comment block directly above the statement it vouches
  for — an annotation inside a preceding statement, or trailing the last one,
  vouches for nothing and is reported.
- **It is checked.** `__tests__/lineage-double-apply.db.test.ts` applies the
  lineage to a scratch database, then re-applies every migration the classifier
  calls `safe` and asserts the catalogue does not move. Writing the comment does
  not make the claim true; that test is what does or does not confirm it.

Write the guard's DDL out literally. `EXECUTE format('ALTER TABLE …')` would
work at runtime and would hide the statement from the destructive-DDL scanner
above, which reads inside dollar-quoted blocks on purpose.

## The other direction: `REPLAY_OVERRIDES`

`@replay: guarded-by` lets a human make a verdict kinder. `REPLAY_OVERRIDES`, in
the same file, is the only way to make one **stricter**, and it exists because
the classifier has one structural blind spot: it judges each migration against
the schema _that file_ expects, while a replay happens against the schema the
_whole lineage_ produced. `DROP TABLE IF EXISTS x` is a no-op in isolation and
drops a live table once a later migration has put `x` back;
`CREATE INDEX IF NOT EXISTS … ON y` is a no-op in isolation and has nothing to
build on once a later migration has dropped `y`. Two bundled migrations are in
exactly those two states.

```ts
{
  tag: '0091_drop_conversation_tags',
  verdict: 'mutates',
  why: '… 0127_conversation_tags_rename puts it back, so a replay drops a live table …',
  stillFailsWith: /conversation_tags/,
}
```

The asymmetry with the annotation is the point:

- **It can only refuse.** `verdict` excludes `safe` in the type and the override
  is applied as the worse of the two verdicts, so "override it to safe" is
  unwritable rather than merely unused.
- **Adding one is cheap, removing one is not.** Delete an entry and its
  migration returns to the replay-safe set that
  `__tests__/lineage-double-apply.db.test.ts` re-applies to a migrated database,
  where it fails by name. An entry cannot be dropped to make something green.
- **A stale entry is named too.** The same test refuses an entry whose shape
  reading has caught up with it, or whose replay no longer fails — so the list
  cannot rot into exemptions nobody has re-checked.

The fix this is standing in for is object lifetimes across the whole corpus; see
the header of `replay-safety.ts`. Until then the correction lives on the
classifier rather than in each caller, so the fleet migrator's gap heal, its
replay gate and the CLI preflight all inherit it from one place.

## What counts as destructive

Detected, at minimum per the brief, plus three additions:

| DDL                                        | Why it breaks a still-running old code version                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DROP COLUMN`                              | A read or write against the column errors immediately.                                                                                                                                                                                                                                                                               |
| `DROP TABLE`                               | Same, for the whole table.                                                                                                                                                                                                                                                                                                           |
| `DROP VIEW` / `DROP MATERIALIZED VIEW`     | Same failure mode as DROP TABLE, for old code that queries the view directly. No historical instance — this codebase has never shipped a SQL view — added defensively since the failure mode is identical and detection costs nothing extra.                                                                                         |
| `DROP TYPE`                                | Old code reading or writing a column typed against the dropped enum/composite type errors. Same "no historical instance, added defensively" note as DROP VIEW.                                                                                                                                                                       |
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

**`COLUMN` is optional everywhere Postgres allows it, and every clause
matches both spellings.** `DROP [COLUMN]`, `ALTER [COLUMN] ... TYPE`, `ALTER
[COLUMN] ... SET NOT NULL`, `ALTER [COLUMN] ... DROP DEFAULT`, and `RENAME
[COLUMN] ... TO` are all legal with the keyword omitted — `ALTER TABLE t
DROP x;` drops a column exactly like `ALTER TABLE t DROP COLUMN x;`. A
scanner that only recognized the long form would silently stop working the
day an author typed the shorthand, so both are pinned in
`__tests__/scan.test.ts`. Making `COLUMN` optional creates a real ambiguity
that's handled explicitly rather than assumed away: with the keyword gone,
bare `DROP x`, `DROP CONSTRAINT x`, `ALTER x DROP DEFAULT`, and `ALTER x
DROP NOT NULL` all start with the literal token `DROP`, so the column-drop
regex carries a negative lookahead excluding `CONSTRAINT` / `DEFAULT` /
`NOT` / `IDENTITY` / `EXPRESSION` right after it — otherwise `ALTER TABLE x
ALTER y DROP DEFAULT` would misread as dropping a column literally named
`default`. The rename side has the same shape (`RENAME x TO y` vs. bare
`RENAME TO y` vs. `RENAME CONSTRAINT x TO y`) and is resolved the same way:
each disambiguation case is a named test, not an assumption.

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
  that's what running it against a catalog clone pre-flight (§10.8) is for.

## Comments and string literals

`stripNoise` blanks both SQL comment styles — `--` line comments and `/* ...
*/` block comments, including Postgres's (non-standard) nested block
comments — and `'...'` string literals before any DDL keyword regex runs, in
that order, as one pass. The ordering matters: a comment is consumed as a
whole span before its contents are ever checked for a quote, so an
apostrophe inside a comment's own prose ("doesn't", "the customer's
request") can never be misread as opening a real string and swallowing
whatever DDL follows it — a failure mode a naive strip-strings-first (or
regex-only) approach falls into. The same pass is what keeps DDL-shaped
words inside a comment (`-- see 0032's DROP COLUMN` or the block-comment
equivalent) or inside a jsonb default's string data from ever reaching a
keyword regex as if they were live code.

## Grandfathering history

All 226 migrations in `packages/db/drizzle` were written before this linter
existed, under the old one-pod-per-workspace assumption where destructive
migrations were safe. Forcing them into churn (retroactively annotating 29
files, none of which are being re-shipped) would not make any workspace safer
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
  inside a `--` comment, a `/* ... */` block comment (including nested
  ones), or a `'...'` string literal; an apostrophe inside either comment
  style; and DDL nested inside a `DO $$ ... $$` block. A dedicated
  `COLUMN keyword is optional` group pins every shorthand form (`DROP x`,
  `ALTER x TYPE`, `ALTER x SET NOT NULL`, `ALTER x DROP DEFAULT`, `RENAME x
TO y`) alongside the specific collision each shorthand risks — `DROP
CONSTRAINT`, `ALTER x DROP DEFAULT`, `ALTER x DROP NOT NULL`, `RENAME
CONSTRAINT`, and a bare table `RENAME TO` are each asserted as still
  correctly resolved, not just assumed safe by construction.

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

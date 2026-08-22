# Migrating a fleet

How a pooled Quackback fleet gets its workspace databases from one schema version
to the next (`SAAS-HOSTING-STACK.md` §10).

`QUACKBACK_TENANCY=single` — every self-hosted install — is untouched by all of
this. One pod owns one database and migrates it at boot, exactly as it always
has.

---

## 1. The problem, stated precisely

**One code version serves workspaces on two schema versions for the duration of
every rollout.** That is not a transient annoyance to engineer around; it is the
permanent condition of a pooled fleet, and everything below follows from it.

`deploy.preDeployCommand` cannot do the migrating. It runs **once per deploy,
not once per workspace**, and making it iterate would put a multi-hour fleet
migration on the deploy critical path — every deploy blocked behind every
workspace's slowest index build.

So: **the control plane records intent, and the app reconciles toward it.**

```
control DB                          app image (QUACKBACK_ROLE=migrator)
──────────                          ─────────────────────────────────
cp_workspace_schema_state              claim a workspace (lease)
  target_version   ← CP writes  ──► migrate its database (direct endpoint)
  cohort           ← CP writes      verify the CATALOGUE, not the ledger
  current_version  ◄── app writes   record what was observed
  postconditions_ok ◄── app writes
```

The executor is the app image and not the control plane, because the migrations
are bundled in `packages/db/drizzle`. If the control plane ran them, version
affinity between "which SQL" and "which code" would be maintained by hand across
two repositories, and the first time they disagreed a workspace would be migrated to
a schema no running build knows about.

## 2. Which executor route, and why

§10.3 described `runMigrations(connStr)` + `ensureConcurrentIndexes()`. That was
**not implementable**: `ensureConcurrentIndexes` was private to
`packages/db/src/migrate.ts`, and that file calls `runMigrations()` at module top
level, so importing it to reach the function _ran migrations as a side effect_.

Two routes were available — spawn the `migrate.ts` CLI as a child process, or
export the steps as callable units. **Callable units, in-process**, for three
reasons in order of weight:

1. **The heal and the verification bracket the migration.** Invalid indexes must
   be dropped _before_ the build and the catalogue swept _after_, and each step's
   failure has to be reportable on its own. A child process offers one exit code
   and stderr to scrape.
2. **`migrate.ts` calls `process.exit(1)` on failure.** In-process that kills the
   migrator mid-fleet — so the CLI route does not merely have a cost, it forces
   the child-process shape rather than being chosen for it.
3. **Concurrency.** §10.3 wants workspaces migrated ~20 at a time. That is 20 Node
   processes each re-parsing the drizzle schema and re-reading 228 SQL files.

The cost is stated rather than hidden: `packages/db` gained a leaf module,
`src/schema-ops.ts`, and `migrate.ts` became a thin wrapper over the same
executor. That is a **reduction** in duplication — the concurrent-index list now
exists once and drives the creator, the heal and the post-condition check.

## 3. What the ledger cannot tell you

`drizzle-orm@0.45.2` wraps the whole migration loop in one
`session.transaction()`. Measured: kills at 1.0/1.5/2.0/2.5 s leave
`applied=0, tables=0`; at 3.0/3.5 s, `226/147`. **Never partial.** So the
_lineage_ is atomic and the reconciler inherits that instead of needing a
resume-from-partial story.

**But only `migrate()` is atomic.** `CREATE EXTENSION`, the concurrent index
builds and `seedSystemData()` all run outside that transaction. A kill in the
tail therefore leaves **a complete ledger and a broken database**, and the
ledger will report success about it.

Three consequences, and they are the shape of the whole module:

|                          |                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Extensions first**     | `runMigrations` never issued `CREATE EXTENSION vector`, and no migration file does either, while `0000_initial` declares `vector` columns. A fresh database migrated through the runtime path could not succeed at all.                                                                               |
| **Heal before building** | An interrupted `CREATE INDEX CONCURRENTLY` leaves an _invalid_ index. `IF NOT EXISTS` then treats it as present — measured, see §5 — so re-running the migrator **certifies** the invalid index rather than repairing it, and exits 0. Invalid non-constraint indexes are dropped _before_ the build. |
| **Verify the catalogue** | Post-conditions are checked against `pg_index` / `pg_extension` / `information_schema`, never against `drizzle.__drizzle_migrations`. The ledger's row count is recorded next to the verdict as a diagnostic, never as evidence.                                                                      |

### What the post-condition check covers, and what it does not

`verifySchemaPostconditions` returned `ok=true` for the two broken workspaces
above, and was right to by its own lights: it checked extensions and the
concurrent indexes and nothing else, while its name promised the schema. A
verdict is only as good as its scope, and it had no way to state its scope.

It now also checks **the shape this build queries with** — every table and
column the Drizzle schema object declares must exist — and returns the list of
checks it performed in `report.covers`, so a reader of a green verdict can see
what green meant without reading the source. The shape check is derived from the
schema the running code queries with, not from a second hand-written list, which
is what makes it worth having: Drizzle emits explicit column lists, so a declared
column that does not exist is not a missing value, it is a throw.

Still **not** covered, stated so a green verdict is readable: types,
nullability, defaults, constraints, triggers and functions. And objects the
database has that this build does not declare are ignored on purpose — a workspace
a newer image has migrated past must keep being served (§6), so extra is never a
violation. Full bidirectional comparison is `db:check-drift`, which needs the
Drizzle Kit toolchain rather than a query.

## 4. Replaying, and the ledger this fleet actually has

Five live gauntlet workspace databases have a complete 226-row ledger that stops at
`0248` while physically carrying assorted later migrations, because every one of
them was applied with raw `psql -f`, which never writes the ledger. A migrator
run against them replays whatever the ledger does not record.

There are two tempting wrong answers.

- **Inventing the ledger rows.** A row asserting a migration ran when nobody
  watched it run is worse than a missing row: a missing row is a question, a
  wrong row is a false answer. Nothing in this module ever inserts a ledger row.
  Drizzle writes them, _after_ it has executed the statements.
- **Refusing anything non-idempotent.** 197 of the 228 bundled migrations are
  plain `CREATE TABLE` / `ADD COLUMN`. That rule refuses every ordinary rollout
  and every fresh workspace, whose replay set starts at `0000_initial`.

The distinction that works is between the **two ways a replay goes wrong**:

| Verdict   | On a second run                 | Handling                                                                                                                    |
| --------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `safe`    | changes nothing                 | proceed                                                                                                                     |
| `errors`  | fails ("column already exists") | **proceed** — `migrate()` is transactional, so the run rolls back whole and Postgres's own message _is_ the drift diagnosis |
| `mutates` | **succeeds and writes**         | **refuse** — the only class atomicity cannot undo                                                                           |

`policy/migration-contract/replay-safety.ts` classifies each migration from its
own SQL, reusing the destructive-DDL scanner's tokenizer so the two agree about
what is a comment and what is a string. Of the 234 bundled migrations: **37
safe, 145 errors, 52 mutates.**

One of those `safe` verdicts is not read off a statement shape. A `DO $$ … $$`
block is opaque to the tokenizer and is refused by default; an author may
override that for one statement with `-- @replay: guarded-by <what the guard
tests>` directly above it, which is how `0256_workspace_key_columns` renames a
column idempotently (Postgres has no `RENAME COLUMN IF EXISTS`). The claim is
narrow — it reaches nothing but a `DO` block — and it is checked rather than
trusted: `migration-contract/__tests__/lineage-double-apply.db.test.ts` applies
the lineage and then re-applies every `safe` migration, and a claim that is
false shows up there as a Postgres error.

The reconciler refuses a workspace whose replay set contains a `mutates` migration
**and whose ledger is non-empty** — a fresh database has nothing to replay, only
to apply. The refusal names the file, the statement and the repair.

**`0255_settings_cloud_tenant_id` is `safe`**, which is what makes this fleet
healable. Its two statements are `ADD COLUMN IF NOT EXISTS` and `COMMENT ON`;
neither touches a value. Established statically _and_ empirically — see §5.

## 4a. Holes, and closing them

Everything above is about a ledger that is _behind_. A ledger can also be
_wrong_, and the two need different machinery.

Drizzle selects `order by created_at desc limit 1` and applies every bundled
entry strictly greater than that one value. So a **hole below the high-water
mark is invisible to the migrator** while being exactly what the compatibility
gate refuses. That split — the reconciler advances the tip, the gate detects
holes — has a dead end in it, because the gate can only refuse. A workspace with a
hole was refused by the gate on every request, forever, and reconciled by the
migrator without being repaired.

Measured on two live workspaces: high-water at `0253` with rows absent for `0249`,
`0250`, `0252`, `0256` and `0257`, `settings.cloud` physically missing, every
page 500ing. A `run` applied `0256` and `0257`, wrote those two rows, and
reported `OK [reconciled] post=true`. Both instruments said the workspace was fine.

### The heal is a DELETE and nothing else

`ledgerGapFor` finds the hole. The close is one statement:

```sql
DELETE FROM drizzle.__drizzle_migrations WHERE created_at >= <earliest missing>
```

and then drizzle replays the span and writes the rows back itself. That is the
whole algorithm, and its shape is the safety argument:

- **It cannot over-claim, structurally.** The only write this codebase performs
  against the ledger is a DELETE, so the resulting ledger is a subset of the one
  it started from. Every surviving row is still drizzle's own evidence; the
  removed ones are claims _withdrawn_, never claims invented. Nothing anywhere
  inserts a row — that rule is unchanged and is what the heal is built on rather
  than around.
- **Under-claiming is the recoverable direction.** A ledger describing less than
  its database is replayed forward by the next run. One describing more is a
  false answer nothing can detect. A crash between the DELETE and the replay
  therefore leaves a state no worse than the hole, which the next pass fixes.
- **The truncation point is the earliest missing entry**, which is the minimal
  deletion that works: after it, the new high-water mark is the largest applied
  value below that point, every bundled entry below it is present (or one of
  _them_ would have been the earliest missing), so what drizzle then applies is
  exactly the bundled entries from the hole onward.

### Two populations, two rules

The replay this enables covers migrations with **different evidence behind
them**, and treating them alike gets one of them wrong.

| Population                                 | What is known    | Rule                           |
| ------------------------------------------ | ---------------- | ------------------------------ |
| **rewrites** — rows the DELETE removes     | they **did** run | must be `safe`, nothing less   |
| **the hole** — entries with no row         | nobody knows     | `errors` ok, `mutates` refused |
| the forward tail above the high-water mark | ordinary rollout | unchanged (§4)                 |

`errors` is tolerable in the hole for the reason it is tolerable in any rollout:
`migrate()` is one transaction, so the run rolls back whole and Postgres's own
message is the diagnosis. In the **rewrites** it is not a risk but a
_certainty_ — measured, on a scratch database carrying the whole lineage:

```
truncate past 0246, replay
  → Failed query: -- User tags: ... (0247_user_tags)
  → ledger 223 rows, unchanged by the failure
```

and because nothing can put the deleted rows back, a truncation that then cannot
replay leaves the workspace under-claiming further than it started with no run that
can ever succeed. **That is why the refusal happens before the DELETE**, and it
is asserted as such: the refusal tests check that the ledger is byte-for-byte
untouched.

A fourth refusal covers rows the truncation would delete that _this build does
not bundle_ — a workspace ahead of the image. Nothing here could rewrite them, so
healing would delete evidence permanently; run the heal from the image that
carries them.

**`--allow-mutating-replay` does not reach any of this.** That flag asserts the
ledger is honest. A hole is proof that it is not.

### What it reports

`plan` prints the hole above the replay set, because the two are different
facts — one says "behind", the other says "wrong" — and because a gapped ledger
reads as nearly current by its high-water mark at the moment it is least
current. On the measured drift it now prints seven where it used to print two.

`run` reports `[healed_ledger_gap]` rather than `[reconciled]`, and the pass
summary carries `gaps_healed=` beside `reconciled=`.

Then the run verifies itself: **every migration the plan named must be recorded
in the ledger afterwards**, or the outcome is a failure however clean the
post-conditions look. Note the question — _did the plan land_, not _is the
ledger still holed_. The truncation turns a hole into a short ledger, and a
short ledger has no hole in it, so the second question is one that cannot fail.
It was written that way first and the falsification pass caught it.

## 5. The evidence

Everything below was run against live workspace databases, not reasoned about.

### `IF NOT EXISTS` certifies an invalid index

```
CREATE INDEX widgets_name_idx …            → valid
(invalidate)                               → listInvalidIndexes → [widgets_name_idx]
CREATE INDEX CONCURRENTLY IF NOT EXISTS …  → SUCCEEDS
                                           → listInvalidIndexes → [widgets_name_idx]   ← still invalid
```

Pinned by `__tests__/schema-ops.test.ts`. This is the fact the heal ordering
rests on, so it is measured rather than assumed.

### A fresh workspace, end to end

```
inst_p10_fleet_a  OK [reconciled]  ledger 0->228  applied=228 healed=0 post=true  164530ms
```

Verified afterwards by `indisvalid`, not by a name list: 7 HNSW and 8 GIN
indexes present, `indisvalid = t` on every one, zero invalid indexes anywhere in
any user schema, both extensions installed, 228 ledger rows.

### A killed `CREATE INDEX CONCURRENTLY`

The blocking transaction is the instrument, not the point: `CREATE INDEX
CONCURRENTLY` commits its catalogue entry (`indisvalid = false`) and _then_ waits
for older snapshots, so an open transaction that has read the table holds the
build in a state where a kill is deterministic rather than a race.

```
session A:  BEGIN; SELECT 1 FROM principal LIMIT 1;   -- holds a snapshot
migrator:   … step concurrent-indexes …
            kill -9 <migrator pid>
```

What it left behind:

```
index_name               | table_name | indisvalid | indisready
posts_embedding_hnsw_idx | posts      | f          | t

ledger_rows | newest
        228 | 1785700000012      <- complete
```

The two verdicts side by side, on that database:

```
THE LEDGER SAYS:     {"upToDate":true,"bundledCount":228,"appliedCount":228}
  floor at 0253:     {"ok":true,"missing":[],"floorTag":"0250_job_queue"}
THE CATALOGUE SAYS:  ok=false
  VIOLATION [invalid_index] public.posts_embedding_hnsw_idx on posts is INVALID (indisready=true)
  VIOLATION [missing_index] kb_articles_embedding_hnsw_idx does not exist
  … 5 more
```

And the control that shows why re-running is not a repair — on the live workspace
database, not a local one:

```
CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_embedding_hnsw_idx …
NOTICE:  relation "posts_embedding_hnsw_idx" already exists, skipping
CREATE INDEX          <- exit 0
posts_embedding_hnsw_idx | f     <- still INVALID
```

Then the next migrator run, which heals rather than certifies:

```
reaped(requeued=1)                                   <- the killed owner's lease
inst_p10_fleet_c  OK [reconciled]  ledger 228->228  applied=0 healed=1 post=true
all 7 concurrent indexes indisvalid = t · 0 invalid anywhere
```

### The five ledger-behind databases

Before — a complete 226-row ledger stopping at `0248`, over five different
physical schemas:

```
alpha  ledger=226 @0248   0251=0 0252=0 0253=1
bravo  ledger=226 @0248   0251=0 0252=0 0253=1
t1     ledger=226 @0248   0251=1 0252=1 0253=1
t2     ledger=226 @0248   0251=1 0252=1 0253=1
t3     ledger=226 @0248   0251=0 0252=1 0253=0
```

The progress ledger recorded these as "physically carrying 0251, 0252 and
0253". They carry _different subsets_ — which is the harder case and the one
that makes a per-migration decision necessary rather than a blanket one.

After one `run --concurrency 6`:

```
alpha  OK [reconciled] ledger 226->228 applied=2 post=true   24728ms
bravo  OK [reconciled] ledger 226->228 applied=2 post=true   24375ms
t1     OK [reconciled] ledger 226->228 applied=2 post=true   27313ms
t2     OK [reconciled] ledger 226->228 applied=2 post=true   29320ms
t3     OK [reconciled] ledger 226->228 applied=2 post=true   30267ms
t4     OK [reconciled] ledger 228->229 applied=1 post=true   24284ms
```

`t4` is the interesting one: it carries `0252`, which this build does not
bundle, so it ends at 229 rows — ahead of the code, and correctly so.

### Two migrators, one fleet

Ten workspaces set claimable, `attempts` reset to 0, two `run --concurrency 3`
processes started together:

```
migrator A  claimed=4   t2, t3, t4, p10-old
migrator B  claimed=6   alpha, bravo, t1, fleet-a, fleet-b, fleet-c

attempts | workspaces
       1 |      10        <- every workspace claimed exactly once
```

Note the durations: 2–6 s each rather than the 25–165 s a real reconcile takes.
That is the cheap path — nothing to apply and clean post-conditions, so the
executor is never started and no index is rebuilt. A pass over an
already-reconciled fleet costs one query per workspace, which is what keeps §10.7's
cost model intact.

### Why the gate exists at all

Expand-only is necessary but **not sufficient**, and the demo below is of the
mechanism rather than of the motivation, so here is the motivation. A database
migrated to `0247`, against a build that ships `0248` (which adds
`changelog_entries.segment_ids`, a column the TS schema knows about):

```
ledger: 225 rows

1. WITHOUT the gate — this build issues its own column list:
   findFirst() THREW: 42703 column "segment_ids" does not exist

2. WITH the gate at MIN_SCHEMA_VERSION=0248:
   evaluateSchemaFloor -> ok=false missing=["0248_changelog_entry_segments"]
   ...refused before the query is ever issued

3. CONTROL — the same query on a database that HAS 0248:
   findFirst() SUCCEEDED
```

The control is what makes it evidence: without it, the throw in (1) would be
equally consistent with a broken query.

**Note that `0251` cannot demonstrate this**, and that is deliberate rather than
lucky: its column is not in the TS schema, so nothing selects it and a pre-0251
database serves fine with the gate off. The fixture in the next section is
therefore a demo of the _gate_, not of the hazard.

### The gate, both directions

`p10-old2` is a database migrated against a journal trimmed at `0248` — a
genuinely old lineage, not a doctored ledger.

```
MIN_SCHEMA_VERSION unset
  p10-old2 -> 200   ws-t1 -> 200   ws-t4 -> 200

MIN_SCHEMA_VERSION=0251
  p10-old2 -> 503 retry-after=30  "This workspace is being updated…"
  ws-t1  -> 200
  ws-t4  -> 200      <- carries 0252, which this build has never heard of
```

(An earlier `p10-old` played this role and was destroyed by a later
`run --concurrency 6` — the fixture was reconciled forward by the very thing it
existed to be behind. Its replacement is held out of the rollout by a `blocked`
intent row rather than by a note asking people not to migrate it.)

The gate-off row is the control: without it, a 503 would be equally consistent
with the workspace being broken for some unrelated reason.

Reproduce with `scripts/fleet-migrator.ts` and the runbook in §7.

### `0251` replayed against a database that already carries it

The instrument is this, and it is written out so a reader can re-derive the
digest rather than take four hex strings on trust — the earlier version of this
section published the values without the expression, which made them decoration:

```sql
SELECT md5(t::text) FROM (SELECT
   (SELECT md5(string_agg(s::text,'|')) FROM settings s)                       AS settings_rows,
   (SELECT md5(string_agg(column_name||':'||data_type||':'||
                          coalesce(column_default,'')||':'||is_nullable, '|'
                          ORDER BY ordinal_position))
      FROM information_schema.columns WHERE table_name='settings')             AS settings_cols,
   (SELECT col_description('settings'::regclass, ordinal_position::int)
      FROM information_schema.columns
     WHERE table_name='settings' AND column_name='cloud_workspace_key')            AS col_comment,
   (SELECT cloud_workspace_key FROM settings LIMIT 1)                              AS stamp
) t
```

It covers all four things a replay of `0251` could plausibly disturb: the row
data, the column's shape, the column's comment and the stamp itself.

```
BEFORE   digest D0                     stamp = inst_gauntlet_ws_t1
psql -f 0255_settings_cloud_tenant_id.sql
         NOTICE: column "cloud_workspace_key" of relation "settings" already exists, skipping
AFTER    digest D0   ← unchanged       stamp = inst_gauntlet_ws_t1
```

With the controls that make "unchanged" mean something:

```
COMMENT ON COLUMN settings.cloud_workspace_key IS 'CONTROL'   → digest CHANGES
replay 0251                                               → digest returns to D0
UPDATE settings SET cloud_workspace_key = … || '_CONTROL'     → digest CHANGES
restore                                                   → digest returns to D0
```

The instrument moves on a comment change and on a value change. It did not move
on the replay. (The literal digests are omitted deliberately: they are specific
to one workspace's data at one moment, so a reader re-running this will get
different values — what has to match is _before equals after_, and _control
differs from both_.)

## 6. The compatibility gate

`MIN_SCHEMA_VERSION` is where a build states the oldest schema it tolerates.
Checked on **pool checkout**, in the same pass as the §3 fingerprint and cached
the same way.

Expand-only is necessary but **not sufficient**: Drizzle emits explicit column
lists, so a build that postdates an additive migration issues
`select "id", …, "cloud", … from "settings"` and `findFirst()` _throws_ where the
column does not exist. A missing value and a missing column are not the same
thing.

Two properties, and the second is the one that is easy to get wrong.

- **A workspace below the floor degrades alone.** 503 for that workspace, with
  `Retry-After`, a distinct log line and a distinct message — never confused with
  a fingerprint refusal, which means "wrong database" and is a security event.
- **A workspace _ahead_ of the code is served normally.** During a rollout the new
  image migrates a workspace that not-yet-restarted replicas are still serving.
  Refusing it there would turn every rollout into an outage on the way in. This
  is why `getMigrationStatus()`'s bundled-⊆-applied semantics are kept
  deliberately rather than "fixed".

The check is a **prefix**, not a high-water mark: every bundled migration at or
below the floor must be in the ledger. A ledger is a set, not a counter, and this
fleet has proved it — five databases whose newest row is `0248` while later
migrations are physically present. `max(created_at) >= floor` would read a
gapped ledger as satisfied.

The gate reads the **workspace's own ledger**, not the control plane's
`current_version`. The control row is a belief, only as fresh as the last
reconcile; the workspace's ledger is what the failing query will actually be issued
against.

Unset `MIN_SCHEMA_VERSION` means no floor. A value naming no bundled migration
**throws** rather than degrading to no floor — a typo must not produce a gate
that is off while every dashboard says it is on.

## 7. Running it

```bash
# what a run WOULD apply, whether the ledger has a hole in it, and whether any
# of it is replay-dangerous. Reports the refusal an operator would get, if any.
bun run scripts/fleet-migrator.ts plan --workspace inst_x

# create intent rows for active workspaces that have none, at this build's version
bun run scripts/fleet-migrator.ts enrol

# stage a rollout
bun run scripts/fleet-migrator.ts set-target --cohort canary --target 0253
bun run scripts/fleet-migrator.ts run --cohort canary
bun run scripts/fleet-migrator.ts run --concurrency 8

bun run scripts/fleet-migrator.ts status
bun run scripts/fleet-migrator.ts block --workspace inst_x --reason "under investigation"
```

Exit codes are the contract, because a `deploy.cronSchedule` service is judged on
them: `0` all claimed workspaces reconciled or already current · `1` at least one
failed, halt and read · `2` the invocation was wrong.

### Configuration is validated at boot, and a bad value exits

`MIN_SCHEMA_VERSION` and `QUACKBACK_ROLE` are checked by
`lib/server/boot-config.ts`, called as the **first statement of `server.ts`** —
above the eager database warmup, so the refusal happens before any socket is
opened. That ordering is asserted on the source, because no unit test of either
function can see it.

**It exits non-zero rather than throwing**, and the difference is not stylistic.
A throw at that point happens during ESM evaluation of the server entry, Node
caches the module-evaluation error, and every route 500s forever —
`/api/health/live` included, so a supervisor watching liveness sees a process
that is up and answering. Measured in that state: the process kept its socket
open and made **7,417 connection attempts** to the database it had just declared
itself unfit to serve. On a pooled fleet each of those wakes a workspace
compute, so one mistyped variable becomes a fleet-wide cost problem.

Measured after the change, with the good-config row as the control:

```
MIN_SCHEMA_VERSION=9999   exit=1  REFUSING TO START   control-DB transactions during boot: 0
QUACKBACK_ROLE=banana     exit=1  REFUSING TO START   control-DB transactions during boot: 0
MIN_SCHEMA_VERSION=0251   runs on to logStartupBanner()  control-DB transactions during boot: 3
```

There is deliberately **no readiness check** for either variable: after the boot
assert, a process serving requests cannot have bad configuration, so a check for
it would be unreachable code that reads as coverage. An earlier revision had
one, reachable only from a test harness that skipped the boot path.

**In `vite dev` the picture is different and worth knowing.** The SSR
environment runs in a separate runner process, so the exit kills the runner and
vite restarts it — a crash loop rather than a clean exit, with vite answering
`500 socket hang up`. That response is 1.2 KB and contains none of the offending
value; the previous behaviour returned a 66 KB HTML error page carrying it six
times.

### Environment

| Variable                         | Meaning                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `QUACKBACK_ROLE=migrator`        | serves nothing, runs no queues. `shouldRunWorkers()` is an allowlist, so this role starts neither the job worker nor the sweepers |
| `QUACKBACK_TENANCY=pooled`       | required; the registry is the workspace source                                                                                    |
| `QUACKBACK_CONTROL_DATABASE_URL` | where `cp_workspace_schema_state` lives                                                                                           |
| `MIN_SCHEMA_VERSION`             | the serving floor. Read by the **web** role, not by this one                                                                      |

### Connections

The migrator builds its own connection from the workspace record's **`directUrl`**,
and refuses a DSN whose host looks like a transaction-mode pooler.

**The usual justification for that is wrong, and the real one is worse.**
Measured through the pooled endpoint:

|                                                  | pooled                              | direct |
| ------------------------------------------------ | ----------------------------------- | ------ |
| `CREATE INDEX CONCURRENTLY`                      | **works**, and yields a valid index | works  |
| `pg_advisory_lock` released on client disconnect | **no**                              | yes    |
| second client gets the same lock                 | **depends on routing** — see below  | no     |
| a _direct_ client can then take that key         | **no — blocks**                     | —      |

CIC is one statement to the client; its multi-transaction dance happens
server-side where the pooler cannot see it, so it passes through fine —
including across a 22.8 s server-side wait for old snapshots. The advisory lock
is the casualty: a pooled client's "session" is a server connection the pooler
keeps alive after the client has gone, so the lock survives disconnect **and
then wedges the direct endpoint** — verified by watching a direct
`pg_advisory_lock` die on a 10 s `lock_timeout` until the stranded backend was
terminated by hand.

**The middle row needs stating carefully, because the obvious reading of it is
wrong.** A second pooled client asking for the held key got `t`, and the
tempting conclusion — "the lock simply does not work through a pooler" — is not
what happened. PgBouncer had routed that client onto the **same backend**, so it
re-entered the lock it already held: hold count 2, and the third unlock returned
`false`. Forced onto a _fresh_ backend, `pg_try_advisory_lock` correctly
returned `false`.

So the mutex does not fail cleanly. **It fails open non-deterministically,
depending on which backend the pooler happens to hand you** — which is worse
than a mutex that never works, because it works in testing. A migrator run
through the pooler therefore loses its serialisation _sometimes_, and strands a
lock that blocks every subsequent direct run of the same workspace _always_.

**A related finding that reaches past this piece:** the pooler runs no session
reset between clients. A `statement_timeout=7654ms` set by one client was read
back by a _different_ client landing on the same backend. Any per-session `SET`
through the pooled endpoint is shared state, not client state.

It does **not** go through the workspace pool cache, for two reasons that are both
correctness: the pool cache terminates at the _pooled_ endpoint, and it asserts
the §3 fingerprint on checkout — which a freshly provisioned database has not
been stamped for yet. A migrator that could only run against already-stamped
databases could not do the job provisioning needs it for.

**A migrator holds a direct session-mode connection for the duration of a
workspace's migration, which keeps that workspace's compute awake.** That is
unavoidable and bounded; it is also why the migrator is a separate role from the
pooled web tier, whose whole cost model depends on going silent.

### Locks, and why the lineage runs under a `lock_timeout`

**Every measurement in the table above was taken against an idle database.** The
one below was not, and it is the difference that matters.

A workspace being reconciled has a **live worker tier**. Its job poller holds ROW
EXCLUSIVE on `job_queue` more or less continuously, and `0250_job_queue` both
builds indexes on that table (SHARE) and replaces its wake trigger (`DROP
TRIGGER IF EXISTS job_queue_wake_trg` / `CREATE TRIGGER`, SHARE ROW EXCLUSIVE).
Both conflict with ROW EXCLUSIVE. On a fresh rollout nothing contends, because
the table does not exist yet; on a **replay** — which is what healing a hole
spanning `0253` does — it does.

Reproduced on a scratch database carrying the full lineage, with one session
holding the poller's lock:

```
no lock_timeout:  still pending after 2000 ms
                  pg_locks on job_queue: ShareLock granted=false
                                         RowExclusiveLock granted=true
                  → completes 9 ms after the holder rolls back

lock_timeout=1s:  fails after 1022 ms, SQLSTATE 55P03
                  "canceling statement due to lock timeout"
                  ledger unchanged — the lineage is one transaction
```

The wait is unbounded, and the migration transaction has already touched
`job_queue` by the time it asks, so it is upgrading a lock it holds while
another session holds a conflicting one — the shape that becomes a deadlock
rather than a queue as soon as the poller wants something the migrator holds.
Nothing is corrupted either way (the transaction rolls back whole), but it can
stall or fail a rollout at random on any workspace whose worker is busy.

So the fleet migrator sets `lock_timeout` for the lineage —
`DEFAULT_MIGRATE_LOCK_TIMEOUT_MS`, 30 s. **This does not prevent the contention;
it bounds it.** A `55P03` rolls the run back, the reconciler records it with the
migration named in the message, and the lease's existing backoff retries — which
is a better retry than a new one, because it counts against `max_attempts` and so
cannot loop forever against a workspace whose worker never goes quiet.

Three deliberate choices:

- **Scoped to the lineage**, set before `migrate()` and cleared after. The
  concurrent index step that follows waits on old snapshots rather than on locks,
  and a timeout there would abort a build that was making progress.
- **Off by default in `runMigrations`.** The boot path (`migrate.ts`) keeps its
  historical unbounded wait; a self-hosted install migrating its own database at
  startup has no fleet to protect and no reconciler to retry it.
- **No quiescing of the worker tier.** Draining a workspace's jobs before migrating
  it would be a larger mechanism than the problem, and the timeout plus the
  existing retry already turns the failure into a bounded, named, self-clearing
  one.

### Sizing the lease

The lease must outlive the slowest workspace migration. Measured on a 0.25 CU
compute, a fresh database:

| step                                      | elapsed    |
| ----------------------------------------- | ---------- |
| extensions                                | ~1 s       |
| migrate (228 migrations, one transaction) | ~0.1 s     |
| **concurrent indexes (8 builds)**         | **~141 s** |
| seed                                      | ~1 s       |
| verify                                    | ~20 s      |

The index builds dominate, on empty tables, because each `CREATE INDEX
CONCURRENTLY` is several round trips and several catalogue transactions. The
default lease is 15 minutes and the heartbeat a third of that. On a large workspace,
raise it — and note that the reaper's terminal branch means a workspace whose
migration reliably outlives its lease will exhaust `max_attempts` and stop being
claimed, which is the correct outcome and needs an operator, not a longer retry.

## 8. What the reconciler will not do

- **Insert a ledger row.** Ever. Drizzle writes them after executing the SQL.
  Healing a hole is a DELETE and a replay; the rows that come back are written by
  drizzle, after the fact, as a consequence of having run.
- **Truncate a ledger it has not first established is safe to replay.** The
  refusal happens before the DELETE, because a truncation that cannot then
  replay is unrecoverable. Asserted, not intended: the refusal tests check the
  ledger is untouched.
- **Heal a hole containing a data-mutating migration**, or one whose rewritten
  rows are not no-ops, or one that would discard rows this build cannot rewrite.
  Three refusals, each naming the migration. `--allow-mutating-replay` overrides
  none of them: it asserts the ledger is honest, and a hole is proof otherwise.
- **Report `reconciled` for a run whose migrations the ledger does not record.**
- **Record `succeeded` without a catalogue-verified verdict.** Refused in code
  and by a database `CHECK`.
- **Record `succeeded` below the target.** A migrator whose bundle is older than
  the target would otherwise apply everything it has, observe a lower version,
  and mark the workspace reconciled — and the row would then be _unclaimable_,
  because the claim narrows on `current_version < target_version`. The rollout
  would report complete having skipped it. Refused in code and by the same
  `CHECK`. Found by a test rather than by reasoning.
- **Migrate a workspace the request path would refuse.** Workspaces are read through
  `listActiveWorkspaces`, the same reader with the same contract validation, so a
  half-written record cannot become a migrated one.
- **Replay a data-mutating migration onto a database with a non-empty ledger**,
  without an explicit `--allow-mutating-replay`.

## 9. Gates, and one that is red for reasons that predate this

`bun run db:check-drift` reports **4 drift statements** on this branch:

```
ALTER TABLE "job_queue" DROP CONSTRAINT "job_queue_status_check";
ALTER TABLE "job_queue" DROP CONSTRAINT "job_queue_max_attempts_check";
ALTER TABLE "job_queue" DROP CONSTRAINT "job_queue_lease_shape_check";
ALTER TABLE "settings" DROP COLUMN "cloud_workspace_key";
```

All four are raw-SQL-owned objects absent from the Drizzle TS schema —
`settings.cloud_workspace_key` from `0251` and the three `job_queue` CHECKs from
`0253` — and they reproduce **byte-identical** on the branch that introduced
them, with none of this piece's code present.

**The attribution is scoped to those four statements and not to the full
output.** The rest of the output does differ here: this branch passes
`{ concurrentIndexes: false, verify: false }` from `check-drift.ts` and sets
`onnotice: () => {}` on the migrate connection, so roughly 109 `NOTICE` lines
that appear on the older branch do not appear on this one. Those are ours. The
drift is not.

## 10. Known limits

- **The replay classifier cannot see inside a `DO $$ … $$` block**, so it calls
  every one of them `mutates`. That is the conservative direction and it costs a
  refusal an operator can override; the alternative is claiming to parse plpgsql.
- **It inherits the destructive-DDL scanner's tokenizer limitation**: a
  dollar-quoted _string literal_ containing an unbalanced apostrophe can desync
  the stripper. Every `$$` block in this repository is a balanced `DO`/`pg_temp`
  body, so the corpus is clean today, but it is a silent miss and it is one
  limitation shared with the linter rather than a second one.
- **The pooled-DSN guard is a hostname heuristic** (`-pooler.`), matching the
  control plane's own `direct_not_pooler` CHECK. It refuses rather than probes,
  deliberately: the probe most people reach for is asking the catalogue whether
  a session is pooled, and catalogue answers about pooling have already produced
  one false green in this work.
- **The control-plane side now writes intent.** §10.3 assigns `target_version`
  writing and rollout-status rendering to the CP. Provision enrols a row,
  `/admin` Schema and MCP `get_instance` / `fleet_health` render it, and the
  worker HTTP executor (`/api/internal/fleet/migrate`) applies this image's
  lineage. The `fleet-migrator` CLI still writes the same columns as
  break-glass. The contract the table encodes — CP writes `target_version` and
  `cohort`, the app writes only observations — is enforced by `CHECK`s rather
  than by convention.
- **A workspace already recorded at its target cannot be claimed, so it cannot be
  healed by a plain `run`.** The claim narrows on
  `current_version < target_version`, and a workspace with a hole was recorded at
  the target by a run that healed nothing — which is exactly the state the two
  live workspaces are in. The reason it is broken is the reason nothing will look at
  it again.

  `plan --workspace X` reports the hole regardless of claim state, and
  `run --workspace X` now reads the workspace's own ledger before agreeing with an
  `already_current` verdict and exits 1 naming the missing migrations. Clearing
  the observation so the reconciler can claim it is a **control-plane write**,
  and deliberately not a command here: `current_version` is an observation this
  app writes, but the `succeeded` status is guarded by `CHECK`s that live in the
  CP's own migration `0049`, in another repository, and shipping an `UPDATE`
  against constraints that cannot be read or tested from here is how a repair
  tool becomes an incident. The write an operator needs is
  `UPDATE cp_workspace_schema_state SET current_version = NULL, status = 'pending',
attempts = 0 WHERE workspace_key = ...` — status and version together, because the
  `CHECK` couples them. Making that a first-class command belongs with the CP
  work that owns the table.

- **Catalog-clone preflight (§10.8) is not built.** `plan` reports the replay set
  and its verdicts against the live database, which is the cheap half; dry-running
  a release against a branch of the largest and oldest workspace is not.
- **`required` vs `deferred` migration classes (§10.7) are not built.** Every
  migration is eager today, so a fleet-wide rollout wakes every suspended compute.

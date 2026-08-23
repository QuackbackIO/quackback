# The Postgres job queue

Background work on Postgres, per workspace, with leases. This is the substrate that
replaces Redis for the background tier (`SAAS-HOSTING-STACK.md` §7).

`QUACKBACK_TENANCY=single` — the default and every self-hosted install — gets one
loop, no workspace scope, and the same scheduled jobs on the cadences they have
always run on. Nothing here needs a registry or a control plane.

---

## 1. Why a lease, and not just `SKIP LOCKED`

`SELECT … FOR UPDATE SKIP LOCKED` is the standard Postgres queue claim, and on
its own it is not enough for this application. **The row lock releases the
instant the claiming transaction commits**, so the only way to hold a job for the
duration of the work is to keep that transaction open — which pins vacuum,
occupies a pooler slot, and turns a slow AI call into a database problem.
`help-center-translate` already needs a 120-second lock today; an export build or
a large import needs far more.

So the claim and the work are separated:

```
claimJobs()      short transaction: pending -> running, stamp lease + fencing token   COMMIT
<handler runs>   NO transaction open. Any duration.
heartbeatJob()   pushes locked_until forward, guarded by the fencing token
completeJob()    short transaction: running -> succeeded
```

and `reapExpiredLeases()` adjudicates leases whose owner died.

Measured, not asserted: a claimed row can be taken `FOR UPDATE NOWAIT` from
another connection while the job is still leased (`__tests__/job-queue.test.ts`),
and `pg_stat_activity` shows zero backends in a transaction while a job is held
across minutes of work (`scripts/job-lease-proof.ts long-lease`).

## 2. The reaper, and the thing it must never do

`import` and `export` deliberately run with one attempt, because a retry would
**double-import a customer's data**. A reaper that returned every expired lease
to `pending` would silently convert _"this job must run at most once"_ into
_"this job runs again whenever a process dies mid-work"_ — the same defect, with
no error and no log, arriving only under the failure it was meant to survive.

Two rules make at-most-once expressible. They are the same rule stated twice on
purpose, so neither is the only one:

1. **`attempts` is incremented by the CLAIM**, never by completion. A job with
   `maxAttempts: 1` that was claimed even once already reads `attempts = 1`, so
   it is spent whether or not anything ever reported back.
2. **`attempts < max_attempts` gates both the claim and the reaper's requeue.** A
   spent job is not claimable and is not requeueable; an expired lease on one
   becomes terminal `failed` with a named reason.

There is also a database-level `CHECK` that a `running` row carries a lease and a
non-`running` row does not, so a NULL `locked_until` can never read as "expired".

**At-most-once means exactly that.** A killed no-retry job may end up having run
zero times or once — never twice. "Always exactly once" is available to nobody:
it would require the side effect and the bookkeeping to commit together, and the
side effect is usually not in this database.

### Measured, at every kill point

`scripts/job-lease-proof.ts kill-matrix` SIGKILLs a worker at each of four
stages, then lets the reaper and a fresh worker do whatever they will.

| kill point                                             | maxAttempts=1 executions | maxAttempts=3 executions |
| ------------------------------------------------------ | ------------------------ | ------------------------ |
| after the claim commits                                | 0                        | 1                        |
| after the side effect is written                       | **1**                    | **2**                    |
| after the work finishes, before completion is recorded | **1**                    | **2**                    |
| after completion is recorded                           | 1                        | 1                        |

The right-hand column is the point of the table. It is a **positive control**: it
proves the harness can see a double execution. Without it, the left-hand column
of ones would be equally consistent with a harness that observes nothing, and the
run refuses to report a pass if the control does not fire.

## 3. The fencing token

Every write after the claim is guarded by `lease_token`. A process that stalls
past its lease, has its job reaped, then resumes and reports success updates zero
rows and is told its lease was lost. Without the token it would overwrite
whatever the job's new owner had done.

`heartbeatJob` returning `false` is the same signal arriving earlier: the reaper
decided this worker was dead while it was still working. That means either a
lease shorter than the work or a stalled process, and both are worth seeing, so
it logs at error rather than retrying quietly.

## 4. The workspace boundary

The queue is per-workspace **because the table lives in the workspace's own database**.
There is no shared queue, so there is no routing decision to get wrong and no
workspace parameter on `enqueueJob` — to enqueue for a workspace you must be in that
workspace's scope, at which point you are writing into its database.

That is a structural argument, and §3 of the plan is precisely the observation
that a wrong-workspace answer passes every structural check without erroring. So the
structure is not trusted on its own:

- every row is stamped with the workspace that enqueued it;
- **every claim asserts that stamp against the ambient scope**, and a mismatch is
  refused loudly and made terminal — never executed;
- the assertion lives inside `claimJobs`, not in each caller, so there is no
  version of "forgot to assert".

Demonstrated on a live two-workspace fleet with a database per workspace
(`scripts/job-workspace-proof.ts run`): jobs enqueued for each workspace executed only
against that workspace's own database (confirmed by `current_database()`, not by name),
zero cross-workspace observations in both orderings, and a row planted in one
workspace's queue but stamped for the other was refused:

```
job REFUSED: row workspace does not match the workspace scope that claimed it
last_error = workspace mismatch: row is stamped inst_…bravo, scope is inst_…alpha
```

## 5. The wake, and the connection it needs

A trigger NOTIFYs `quackback_job_wake` on any write that leaves a row runnable
now. A listener on a session-mode connection wakes in milliseconds instead of
waiting out the poll interval.

**`LISTEN` does not survive a transaction-mode pooler, and the obvious health
check lies about it.** Measured on the fleet for this channel, on two workspaces:

| endpoint | notify actually delivered | `pg_listening_channels()` says |
| -------- | ------------------------- | ------------------------------ |
| direct   | **yes**                   | no                             |
| pooled   | **no**                    | **yes**                        |

The catalogue view is not merely a false green here — on this measurement it is
_inverted_, reporting the registration on the connection that never delivers and
not on the one that does. (The mechanism is connection multiplexing:
`postgres.js` puts `LISTEN` on its own connection, which the pooler may or may
not share with the query asking the question.) So:

- the listener is built from the workspace's **direct** DSN, never from the pool
  cache;
- `WakeListener.verify()` sends a real NOTIFY from a _second_ connection and
  waits for it. Nothing here asks the catalogue whether it is registered, and
  nothing should.

**The poll interval is the correctness floor, not a fallback nobody exercises.**
If the doorbell is lost — a dropped connection, a pooled DSN, a NOTIFY that
raced the LISTEN — the poll still fires, so a lost wake costs latency and never
correctness.

Measured wake latency, local Postgres, `JOB_POLL_INTERVAL_MS=1000`:

| doorbell             | n   | min     | p50      | p95      | max      |
| -------------------- | --- | ------- | -------- | -------- | -------- |
| NOTIFY               | 20  | 3 ms    | 4 ms     | 8 ms     | 33 ms    |
| disabled (poll only) | 20  | ~900 ms | ~1000 ms | ~1000 ms | ~1000 ms |

## 6. Scheduling

Cron schedules live on the job definition. On each schedule pass the runner
computes the **most recent slot at or before now** and enqueues it with a dedupe
key of `<queue>:<slot>`; the unique index on `(queue, dedupe_key)` is what makes a
slot spendable exactly once, decided by the database rather than by a lock.

Two properties follow, and both match what the repeatable jobs did:

- **No backfill.** A worker down for three hours runs an hourly sweep once on
  restart, not three times.
- **No duplicate on a race.** Two replicas ticking the same slot produce one row.

The runner then sleeps to the next slot rather than re-asking every second — the
schedule is deterministic, and a tick that finds nothing is pure traffic against
a per-workspace database.

`cron.ts` supports the standard five-field syntax and **throws on anything else**
rather than falling back to a permissive reading. A mis-parsed cron expression
changes a sweep's cadence with no error anywhere, which is not a failure mode a
scheduler should be able to have.

### The scheduler's memory is per workspace, and that is structural

`ScheduleState` is created by each workspace loop and **passed in**. It was a
module-scope `Map` keyed on the schedule name, and that is a cross-workspace defect:
one process runs one loop per workspace, so whichever workspace reached a slot first
advanced a counter every other workspace then read as "already done". Measured live
on two workspaces, each minute's sweep landed on exactly one of them. It
affected every scheduled sweep, and only `page-view-partitions` had a backstop.

Keying the map by workspace would have fixed the instance. Making the state a
parameter fixes the class — there is no shared object left to key wrongly, and
the compiler names every caller that has to decide whose state it is.

`ScheduleTickResult` reports `attempted` alongside `enqueued` for the same
reason. `enqueued` is what the database accepted, so it is 0 when another replica
won the slot — a healthy race. `attempted` is this scheduler's own decision, and
it is the only thing that separates "another replica got there first" from
"this scheduler never considered the slot due", which is what shared state
produced.

### Daylight saving

Both transitions were regressions against the repeatable jobs and both are now
covered by `__tests__/cron-dst.test.ts`, driven tick by tick under
`America/New_York`.

**Spring forward.** The slot search walks _absolute_ time, one minute of real
elapsed time per step, and only interprets each instant locally when asking
whether it matches. Walking wall-clock fields instead — the obvious
implementation — livelocks in the gap: stepping back from 03:00 asks for 02:59,
which does not exist, so the runtime normalises it _forward_ to 03:59 and the
walk oscillates until its budget runs out. `30 2 * * *`, which is
`page-view-partitions`, returned "no slot" on the transition day.

**Fall back.** The slot key is the **instant** (`toISOString()`), not the wall
clock. 01:30 EDT and 01:30 EST are different instants with the same wall clock, so
a local-time key collapsed the repeated hour onto one string and the unique index
threw the second pass away as a duplicate. An hourly schedule produced 7 slots
across 8 hours; a five-minutely one produced 48 where 60 were due.

The tests assert slots per **local calendar day** — 23 on the spring-forward day,
25 on the fall-back day, with the neighbouring days as controls — because a
window with arbitrary bounds cannot state that property.

A schedule whose wall-clock time does not occur on the spring-forward day (02:30)
still does not run that day.

Two things about that residual are worth stating precisely, because the obvious
justifications for it are both wrong. **It is not "what cron does"** — Vixie cron
explicitly runs fixed-time jobs from the skipped interval right after the jump.
It _is_ what the reference does: BullMQ on cron-parser, which is the behaviour
this piece is held to. **And the boot-time partition ensure does not cover it**,
because that only fires at boot and a long-lived process crossing the transition
never boots. What actually makes it harmless is that `ensurePageViewPartitions`
builds a **week ahead**, so a missed day costs one of seven days of runway and
the next day's run restores it.

## 7. Shape of the worker

`loops.ts` runs **one poll loop per workspace**. `workspaces/fleet.ts` already
answers "iterate all workspaces per tick", and that is the right answer for a
periodic sweep and the wrong one for a queue: the latency of an on-demand job
would become the tick interval times the workspace count.

`QUACKBACK_ROLE=web` does not start the job worker. Cloud runs a dedicated
`QUACKBACK_ROLE=worker` replica with a loop per active workspace. Unset
`QUACKBACK_ROLE` still means `all` (self-host).

A workspace whose database has not yet run the job-queue migration is
**skipped with a warning**, not crash-looped.

## 8. Configuration

Read from `process.env` directly rather than through the zod config, matching
`process-role.ts`: these must work in any context, including a worker process that
has not loaded the full application config.

| Variable               | Default | Meaning                                                             |
| ---------------------- | ------- | ------------------------------------------------------------------- |
| `JOB_POLL_INTERVAL_MS` | 1000    | How often each workspace loop claims work                           |
| `JOB_BATCH_SIZE`       | 5       | Jobs claimed per drain pass                                         |
| `JOB_REAP_INTERVAL_MS` | 15000   | How often expired leases are adjudicated                            |
| `JOB_RETENTION_MS`     | 7 days  | How long terminal rows are kept. Must exceed any live cron slot key |

### Worker job logs

Every execution is one structured NDJSON line on stdout. A worker replica
(`QUACKBACK_ROLE=worker`) binds `service_name=quackback-worker`. Filter on
`event` plus `workspace_key` / `queue`. **Payloads are never logged** — IDs
only (`job_id`, `dedupe_key`, `attempt`, `max_attempts`, `duration_ms`).

| `event`              | level        | `msg`                    | when                                              |
| -------------------- | ------------ | ------------------------ | ------------------------------------------------- |
| `job.started`        | info         | `job started`            | handler begins                                    |
| `job.finished`       | info         | `job finished`           | handler succeeded and the lease completed         |
| `job.retrying`       | warn         | `job retrying`           | handler threw, attempts remain                    |
| `job.failed`         | error        | `job failed`             | terminal failure, no handler, or lost lease       |
| `job.loop_started`   | info         | `job loop started`       | a workspace's poll loop armed                     |
| `job.loop_stopped`   | info         | `job loop stopped`       | that loop drained (workspace left, or shutdown)   |
| `job.worker_started` | info         | `job worker started (…)` | worker process has loops running                  |
| `job.worker_stopped` | info         | `job worker stopped`     | worker process drained the loops                  |
| `job.lease_expired`  | warn / error | `expired lease …`        | reaper requeued or terminally failed a dead lease |

`outcome` on a finish/fail line is `succeeded`, `failed`, `retrying`, or
`lease_lost`. A Railway search on `event:"job.failed"` is the pageable set;
retries are `job.retrying` so they do not sit in the same bucket.

## 9. Workspace scope, and the shape this must not reproduce

A BullMQ `Worker` constructed inside a request's workspace scope **inherits that
scope for every job it ever processes** — the constructor captures the
AsyncLocalStorage context, and the queue modules that armed lazily on first
enqueue armed inside whatever request reached them first. Measured on the
BullMQ side with real Redis. No such module remains; the import hazard below
is what outlived them.

This queue does not have that shape, and it is worth being precise about why
rather than asserting it:

- **`loops.ts` opens a fresh `withWorkspaceScopeById(...)` around every pass.** The
  scope a handler runs in belongs to the pass that is running it. There is no
  long-lived worker object holding one.
- **The heartbeat timer is created inside that scope and cleared before the pass
  ends**, so it inherits the scope of its own job — which is correct — and cannot
  outlive it.
- **Handler modules are imported once at tier start, before any scope is open**
  (`primeJobHandlers()`). That closes the quieter version of the same risk: a
  dynamic `import()` executed inside a workspace scope would run the module's top
  level under that workspace's connection.

  **That guarantee reaches exactly as far as the static import graph, and an
  earlier version of this document overstated it.** Priming loads every
  handler _wrapper_ module; three of them deferred their sweep modules to call
  time, which is inside the per-pass workspace scope — and `resolveHandler`'s
  warning could not see it, because it only guards the outer import. Proven on
  the pooled fleet with a top-level probe in `sla.sweep.ts`: `(module not
imported)` after priming, `inst_gauntlet_alpha` after the job worker ran the sweep.

  Those imports are now static, and `__tests__/handler-imports.test.ts` scans
  every registered handler module and fails on a call-time `import(`. A source
  scan rather than a runtime assertion, because the property is about _when_ a
  module loaded and the module registry keeps no record of the scope it loaded
  under. `__tests__/priming.test.ts` pins the other half — that priming actually
  runs — because the scan proves only that the modules _can_ be primed.

  **The scan is one level deep, and the boundary is a cross-piece contract.** It
  reads the wrapper files named by `JOB_DEFINITIONS`, not their graph. Deepening it was measured and
  rejected: the modules those wrappers statically import carry 32 call-time imports
  across 12 files (`settings.service` 24, `conversation.service` 6,
  `pending-actions.service` 2) — ordinary lazy loading, none of it
  queue-specific. So the guarantee is: **the wrappers and their static graph load
  before any scope opens.** Deeper than that, a call-time import runs under
  whatever scope its caller has, which for a request is the _correct_ workspace; the
  hazard is only that the module is then shared process-wide, and only if it
  captured scope-dependent state at its top level.

  **That other half is `lib/server/policy/module-state/`**, the §4.4 scanner,
  which owns every module-scope mutable-state site it can see under
  `lib/server/**`, against a checked-in ledger, **with its recall limits recorded
  in that module's README**. Being a source scan, load order is irrelevant to it
  — it sees a captured singleton whether the module loaded at prime time, at call
  time, or never. That property is the reason coverage genuinely lives elsewhere
  rather than nowhere.

  **So state the dependency honestly: this piece's boundary is sound to exactly
  the degree that scanner's recall is.** It is the reason this piece declined to
  deepen its own scan, so a reader who later doubts the scanner needs to be able
  to find the limit rather than discover it. One gap is worth naming here because
  it is invisible from the ledger: `walkSourceFiles` skips `__tests__`,
  `node_modules`, `dist` and any `*.test.ts`, so a captured singleton in a
  server-side **test helper** is outside the contract entirely. Correct to skip —
  a test helper is not shipped — but not covered, and nobody should assume
  otherwise.

  A memo miss still resolves and logs — but that path only covers the wrapper,
  so the scan is what actually holds the property.

## 10. What runs here

**Every background queue in the process.** There is no second list and no
BullMQ left: `definitions.ts` is the registry, and
`__tests__/registry-doc.test.ts` fails if the table below drifts from it, so
this is derived rather than restated. Counts are deliberately absent from the
prose for the same reason — the last hand-written one ("seven queue modules")
went stale the moment a queue moved.

<!-- QUEUE-TABLE:START — generated from JOB_DEFINITIONS; do not hand-edit -->

| queue                    | cron           | concurrency | maxAttempts | lease |
| ------------------------ | -------------- | ----------- | ----------- | ----- |
| `anon-sweep`             | `0 3 * * *`    | 1           | 3           | 60s   |
| `page-view-partitions`   | `30 2 * * *`   | 1           | 3           | 60s   |
| `sla-breach-sweep`       | `* * * * *`    | 1           | 3           | 60s   |
| `snooze-sweep`           | `* * * * *`    | 1           | 3           | 60s   |
| `workflow-sweep`         | `*/5 * * * *`  | 1           | 3           | 60s   |
| `workflow-retention`     | `0 4 * * *`    | 1           | 3           | 60s   |
| `email-log-retention`    | `0 6 * * *`    | 1           | 3           | 60s   |
| `spam-retention`         | `0 5 * * *`    | 1           | 3           | 60s   |
| `sending-domain-recheck` | `20 6 * * *`   | 1           | 3           | 60s   |
| `analytics`              | `0 * * * *`    | 1           | 3           | 60s   |
| `events`                 | —              | 5           | 6           | 60s   |
| `event-dispatch`         | —              | 5           | 10          | 60s   |
| `segment-evaluation`     | dynamic        | 2           | 3           | 60s   |
| `help-center-translate`  | —              | 1           | 3           | 120s  |
| `email-imap`             | `* * * * *`    | 1           | 1           | 60s   |
| `workflow-dispatch`      | —              | 1           | 3           | 60s   |
| `workflow-wait`          | —              | 4           | 3           | 60s   |
| `import`                 | —              | 2           | 1           | 60s   |
| `export`                 | —              | 1           | 1           | 60s   |
| `membership-sync`        | `*/15 * * * *` | 1           | 10          | 60s   |
| `usage-report`           | `10 * * * *`   | 1           | 10          | 60s   |

<!-- QUEUE-TABLE:END -->

`import` and `export` are the reason this primitive was built the way it was.
They are the at-most-once cases: they carry `maxAttempts: 1`, the claim spends
it before the handler runs, and the reaper's terminal branch is what stops a
process death from becoming a second import. Nothing else about them changed.

### The serial drain is gone, and this is what replaced it

The first cohort drained **serially**: claim a batch, run it to completion, then
go round and tick the schedule. `latestSlotAtOrBefore` returns only the slot
bracketing _now_, so slots that elapse while the loop is inside a long job are
**dropped, not delayed** — under BullMQ the delayed entry lived in Redis and ran
late. Observed live on the first cohort: a workspace whose loop sat inside a 125 s
drain had its 11:10 slot **simply absent**, and took every slot after.

That was negligible while every sweep was sub-second. It stopped being
negligible with `help-center-translate`, whose lease is 120 s.

**Each loop now runs a bounded worker pool.** `dispatchPass` claims what the pool
has room for, starts it, and returns; the loop's next act is the schedule tick,
so a running job never stands between a per-minute sweep and its slot. Three
shapes were available and the other two were rejected for reasons worth keeping:

- **Per-queue loops** multiply the poll traffic by the queue count against a
  per-workspace database, and this loop already holds a connection per workspace open
  by design (§7). One loop keeps one poll, one listener and one claim query per
  pass whatever the queue count.
- **A separate process for the slow queues** splits the deployment on a property
  ("slow") that is not stable — an AI call's duration is not a queue attribute —
  and doubles the always-warm connection count.
- **One undifferentiated pool** loses the reference's per-queue `concurrency`,
  and one of those numbers is load-bearing: `workflow-dispatch` is 1 because it
  is a global FIFO, not because it is slow. Two dispatch jobs in parallel
  reorder a reply and a close on one conversation.

So the cap is **per queue**, the claim asks for exactly the free slots each
queue has (one `LATERAL` query), and each queue's rows are leased for that
queue's own lease rather than the batch's longest.

Measured, on a fixture where one queue holds a 120 s job while a per-minute
schedule ticks alongside it (`scripts/job-concurrency-proof.ts`):

| drain shape                 | slow-queue runs | per-minute slots enqueued |
| --------------------------- | --------------- | ------------------------- |
| serial (the first cohort's) | 1               | **2 of 4**                |
| bounded pool (shipped)      | 1               | **3 of 3**                |

The serial column is the control: it is the shipped loop with the pool awaited
before it comes round again — literally what `drainOnce` did — and it reproduces
the dropped slots rather than asserting them. The run refuses to report a
result if the control does not lose a slot, because "no slots lost" is also
what a harness that cannot see a lost slot would print.

`JOB_MAX_CONCURRENCY` caps one workspace loop's total in-flight jobs. It defaults
to the **sum of every definition's `concurrency`**, which is exactly what the
reference allowed (one `Worker` per queue at its own concurrency), so the
default binds nothing. It exists because a pooled process runs one loop per
workspace, and an operator sizing connections cares about the product.

### What the move fixed rather than preserved

- **`workflow-dispatch`'s dedupe never worked.** The comment promised that
  re-enqueuing an event deduped on `workflow-dispatch:${event.id}`. bullmq
  rejects a custom id containing `:` unless it splits into exactly three parts,
  and that key is two, so every enqueue threw `Custom Id cannot contain :` and
  the trigger was retried to exhaustion. A `dedupe_key` column has no such rule.
  (The same defect hit `workflow-wait:${runId}`, the legacy two-part key a run
  parked before waits were sequence-keyed still used.)
- **Redis held every workspace's payloads in one un-namespaced list per queue.**
  Its shared connection set no key prefix and every queue name was a
  compile-time constant, so any consumer that ever attached would drain all
  workspaces from one list with no workspace discriminator. The queue table lives in the workspace's own
  database, and the claim asserts the row's stamp against the ambient scope.
- **Readiness could not see a missing consumer.** `ok = failed === 0` over
  eagerly-initialised workers reported `workers ok:true total:0` on a replica
  that had constructed none, because a worker never built is not _failed_. A
  worker-role process whose loops are not running is now unready, and the payload
  reports how many workspace loops it is serving.
- **`segment-evaluation`'s schedules stopped being a second copy.** They were
  repeatable jobs written into Redis, which had to be _restored_ at boot in case
  Redis had been cleared. They are now derived from `segments` rows on every
  tick, so there is no scheduler state to lose and nothing to reconcile.

### Measured against the reference

Same seeded database, same script, one run each
(`scripts/queue-parity-probe.ts`):

|                                      | reference `8310ee89d`  | this branch         |
| ------------------------------------ | ---------------------- | ------------------- |
| consumer                             | bullmq worker registry | postgres job worker |
| import: terminal status              | completed              | completed           |
| import: posts visible afterwards     | 2                      | 2                   |
| export: terminal status              | completed              | completed           |
| export: sizeBytes                    | 212258                 | 212198              |
| events: outbox rows published        | 1                      | 1                   |
| events: outbox rows left unpublished | 0                      | 0                   |
| events: hook deliveries              | 3                      | 2                   |

The byte and delivery counts differ because each run adds rows the next one
exports and fans out; the statuses and the post count are the like-for-like
part.

**Two things stopped this being driven over HTTP, both checked rather than
assumed.** A production build's API routes that call a server function fail
with `Server function info not found for 552eb43…` — **reproduced identically
on `8310ee89d`**, so pre-existing — and `vite dev` cannot start on a machine
whose inotify watch budget is exhausted (`ENOSPC`). The probe therefore drives
the same producers those routes call and reads the same rows their pollers
read. `/api/health/ready` _is_ served, and is where the readiness change is
visible.

**A false alarm worth recording**, because it looked exactly like a real
regression: the export job failed under this branch and succeeded on the
reference, repeatably. The cause was a leftover server from an earlier step
still attached to the same database, draining the same `job_queue` under an
environment with no S3 keys. Postgres queues have no per-consumer namespace,
so any process pointed at the database is a consumer — which is the same
property that makes the queue per-workspace, seen from the other side.

### Nothing is still Redis

The queues came here; the generic cache, rate limiting, pub/sub, presence,
visitor hashing and link previews went to `kv/` (see `kv/KV.md`). §7.4's final
cutover has since run: `ioredis` is no longer a dependency, `REDIS_URL` is no
longer read, and no service provisions a Redis. `policy/no-bullmq/` keeps the
queue package out.

**`email-imap` refuses to schedule under pooled tenancy** and says so at error.
Its mailbox is process-wide configuration while the queue is per workspace, so
scheduling it on every workspace's loop would have each workspace poll the _same_
mailbox and ingest the same message into its own database. Not a regression: the
BullMQ worker was never started under pooled tenancy either.

**Domain events are dispatched through this queue.** `emit()` writes an
`event-dispatch` job in the same transaction as the outbox row. The former
outbox relay (`LISTEN outbox_wake`, `outbox_relay_leader`, `relay-tier.ts`)
is gone; see `events/RELAY.md`. Leftover `dispatch_owner = relay` rows are
converted onto the job path when the job worker start.

## 11. Running the evidence

```bash
# lease semantics, kill at every stage, with the positive control
DATABASE_URL=... bun run scripts/job-lease-proof.ts kill-matrix

# a job held across minutes of work with no transaction open, then SIGKILL
DATABASE_URL=... bun run scripts/job-lease-proof.ts long-lease --work-seconds 180

# the workspace boundary, on a real pooled fleet.
# This is the only harness with a cron schedule — job-lease-proof.ts is
# single-workspace and could not see a cross-workspace scheduler defect at all.
env $(cat pooled.env) bun run scripts/job-workspace-proof.ts run --a <id> --b <id>
env $(cat pooled.env) bun run scripts/job-workspace-proof.ts listen-endpoints

# the eight migrated queues, on a real two-workspace fleet: real producers, the
# real registry, both orderings, and a positive control that fails the run if
# any queue produced no effect in either workspace
env $(cat pooled.env) bun run scripts/job-eight-proof.ts run --a <id> --b <id>

# what the serial drain cost, with the serial shape itself as the control
DATABASE_URL=... bun run scripts/job-concurrency-proof.ts --work-seconds 130

# the `events` queue's four properties: the custom retry curve, bulk dedupe,
# cancelable delayed jobs, and webhook auto-disable — each with its control
DATABASE_URL=... bun run scripts/job-events-proof.ts

# like-for-like against the reference build. The SAME file runs on both trees
# against ONE seeded database, driving the real producers and reading the rows
# a caller would poll; it starts whichever consumer the tree has.
DATABASE_URL=... bun run scripts/queue-parity-probe.ts <label>
```

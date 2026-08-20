# The Postgres job queue

Background work on Postgres, per tenant, with leases. This is the substrate that
replaced Redis for the background tier.

`QUACKBACK_TENANCY=single` — the default and every self-hosted install — gets one
loop, no tenant scope, and the same sweeps on the same cadences they have always
run on. Nothing here needs a registry or a control plane.

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
another connection while the job is still leased, and heartbeating a held job
leaves no transaction open — both pinned by `__tests__/job-queue.test.ts`.

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

A one-off proof run (its harness has since been removed) SIGKILLed a worker at
each of four stages, then let the reaper and a fresh worker do whatever they
would:

| kill point                                             | maxAttempts=1 executions | maxAttempts=3 executions |
| ------------------------------------------------------ | ------------------------ | ------------------------ |
| after the claim commits                                | 0                        | 1                        |
| after the side effect is written                       | **1**                    | **2**                    |
| after the work finishes, before completion is recorded | **1**                    | **2**                    |
| after completion is recorded                           | 1                        | 1                        |

The right-hand column is the point of the table. It is a **positive control**: it
proves the harness could see a double execution. Without it, the left-hand column
of ones would be equally consistent with a harness that observes nothing.

The same claim/reap/complete semantics are pinned continuously by
`__tests__/job-queue.test.ts`, which drives every branch — the requeue/terminate
split, the spent-job refusal, concurrent claimers — against a real database.

## 3. The fencing token

Every write after the claim is guarded by `lease_token`. A process that stalls
past its lease, has its job reaped, then resumes and reports success updates zero
rows and is told its lease was lost. Without the token it would overwrite
whatever the job's new owner had done.

`heartbeatJob` returning `false` is the same signal arriving earlier: the reaper
decided this worker was dead while it was still working. That means either a
lease shorter than the work or a stalled process, and both are worth seeing, so
it logs at error rather than retrying quietly.

## 4. The tenant boundary

The queue is per-tenant **because the table lives in the tenant's own database**.
There is no shared queue, so there is no routing decision to get wrong and no
tenant parameter on `enqueueJob` — to enqueue for a tenant you must be in that
tenant's scope, at which point you are writing into its database.

That is a structural argument, and a wrong-tenant answer passes every structural
check without erroring. So the structure is not trusted on its own:

- every row is stamped with the tenant that enqueued it;
- **every claim asserts that stamp against the ambient scope**, and a mismatch is
  refused loudly and made terminal — never executed;
- the assertion lives inside `claimJobs`, not in each caller, so there is no
  version of "forgot to assert".

Demonstrated once on a live two-tenant fleet with a database per tenant: jobs
enqueued for each tenant executed only against that tenant's own database
(confirmed by database identity, not by name), zero cross-tenant observations in
both orderings, and a row planted in one tenant's queue but stamped for the
other was refused:

```
job REFUSED: row tenant does not match the tenant scope that claimed it
last_error = tenant mismatch: row is stamped inst_…bravo, scope is inst_…alpha
```

`__tests__/job-queue.test.ts`'s tenant-assertion suite pins the same refusal.

## 5. Poll-driven, deliberately

There is no doorbell. Each loop claims on a fixed interval
(`JOB_POLL_INTERVAL_MS`, default 5s), so a job starts within one poll interval
of being enqueued. The claim is a single indexed `FOR UPDATE SKIP LOCKED` query,
cheap enough that an idle tenant costs a handful of claim queries per minute.

Two reasons this is a poll rather than a `LISTEN` wake:

- **Background latency is bounded by the poll, and that bound is enough.**
  Nothing on these queues needs sub-second start; anything that does has the
  realtime bus.
- **`LISTEN` does not survive a transaction-mode pooler** — the registration
  lands on whichever backend the pooler picked and notifies are silently never
  delivered — which is one reason the queue polls instead of listening. The one
  consumer that genuinely needs push delivery, the realtime bus, holds its
  LISTEN connection on a direct session-mode DSN (`realtime/pg-listener.ts`).

## 6. Scheduling

Cron schedules live on the job definition. On each schedule pass the runner
computes the **most recent slot at or before now** and enqueues it with a dedupe
key of `<queue>:<slot>`; the unique index on `(queue, dedupe_key)` is what makes a
slot spendable exactly once, decided by the database rather than by a lock.

Two properties follow, and both match what the repeatable jobs did:

- **No backfill.** A tier down for three hours runs an hourly sweep once on
  restart, not three times.
- **No duplicate on a race.** Two replicas ticking the same slot produce one row.

The runner then sleeps to the next slot rather than re-asking every second — the
schedule is deterministic, and a tick that finds nothing is pure traffic against
a per-tenant database.

`cron.ts` supports the standard five-field syntax and **throws on anything else**
rather than falling back to a permissive reading. A mis-parsed cron expression
changes a sweep's cadence with no error anywhere, which is not a failure mode a
scheduler should be able to have.

### Adopting a slot, rather than running it

The first pass of a scheduler **adopts** the current slot without enqueueing it.
That is not an optimisation — it is the behaviour the repeatable jobs had, and
its absence was a divergence caught by running the old and new builds side by
side: registering a repeatable job schedules its NEXT occurrence, it does not
run the occurrence that has already passed. Without the seed, a process booting
at 14:00 immediately runs the 03:00 daily sweep — once, because the dedupe key
makes a slot spendable once, but at entirely the wrong time of day.

The residual difference is narrow and worth stating: the repeatable job's next
occurrence used to survive a restart in the queue store, while this seed is per
process. A restart in the same minute as a slot skips that slot. A restart at
any other time does not.

### The cron gate

A definition may carry `cronEnabled`, evaluated per tick. A false answer means
the schedule is inert — no row is written — rather than the job being enqueued
and the handler returning early, which would fill the table with no-ops.

`deadlines.ts` supplies the standard gate. The per-minute crons
(`sla-breach-sweep`, `snooze-sweep`) are not periodic work but **deadline**
work: a conversation is snoozed _until_ a stated instant, an SLA clock is due
_at_ one, and the database already knows every one of those instants. So a queue
registers a provider answering "when is this tenant's next deadline?", and
`dueWithin(queue, windowMs)` shuts the schedule when nothing falls due inside
the slot. The window is the schedule's own slot length, so the gate can only
ever suppress a tick that had nothing to do — nothing is noticed later than it
would be ungated. The fail-safe direction is towards running: no provider, or a
provider that throws, reads as "due now", because a wrong "now" costs a tick
that finds nothing and a wrong "never" is work that never runs.

**A gated-off tick still spends its slot.** A shut gate means the slot had
nothing to do, which is the same as having done it; recording it is what makes
the _next_ slot new when the gate opens. Without that the gate was silently
self-defeating: a schedule that never ticks has no slot memory, a pass with no
memory is a first pass, and a first pass adopts rather than runs — so a gate
that opened was always a first pass and the work never ran. Measured against a
real tenant, a snooze due in ninety seconds was never swept at all.
`__tests__/deadlines.test.ts` and `runner.test.ts`'s gating suite pin both
halves.

### The scheduler's memory is per tenant, and that is structural

`ScheduleState` is created by each tenant loop and **passed in**. It was a
module-scope `Map` keyed on the schedule name, and that is a cross-tenant defect:
one process runs one loop per tenant, so whichever tenant reached a slot first
advanced a counter every other tenant then read as "already done". Measured live
on a two-tenant fleet, each minute's sweep landed on exactly one of them. It
affected every cron sweep, and only `page-view-partitions` had a backstop.

Keying the map by tenant would have fixed the instance. Making the state a
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

## 7. Shape of the tier

`tier.ts` runs **one loop per tenant**. `tenancy/fleet.ts` already answers
"iterate all tenants per tick", and that is the right answer for a periodic
sweep and the wrong one for a queue: one pass across N tenants serialises every
tenant's claim behind every other tenant's, so one slow tenant delays them all.
Each loop owns its own schedule state and its own bounded pool, and the fleet
iteration is reduced to _discovering_ tenants (the list is re-read every minute)
rather than driving work.

A tenant is **proved servable before it is polled**: the loop opens an empty
scope first, and a refusal lands in `tenancy/quarantine`'s backoff instead of
being retried at the poll interval forever. A changed registry record nudges a
quarantined loop awake, so an operator's repair is acted on without waiting out
the backoff.

A tenant whose database has not yet run migration `0250` is **skipped with a
warning**, not crash-looped. Expand lands before the code that reads it, and a
queue tier that died on a mid-rollout fleet would turn that ordering into an
outage.

## 8. Configuration

Read from `process.env` directly rather than through the zod config, matching
`process-role.ts`: these must work in any context, including a worker process that
has not loaded the full application config.

| Variable                | Default                      | Meaning                                                             |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------- |
| `JOB_POLL_INTERVAL_MS`  | 5000                         | Claim cadence. A job starts within one poll interval of enqueue     |
| `JOB_BATCH_SIZE`        | 5                            | Ceiling on rows claimed from ONE queue in a single pass             |
| `JOB_REAP_INTERVAL_MS`  | 60000                        | How often expired leases are adjudicated                            |
| `JOB_PRUNE_INTERVAL_MS` | 1 hour                       | How often terminal rows past retention are deleted                  |
| `JOB_RETENTION_MS`      | 7 days                       | How long terminal rows are kept. Must exceed any live cron slot key |
| `JOB_MAX_CONCURRENCY`   | sum of per-queue concurrency | Ceiling on one tenant loop's in-flight jobs (see §10)               |

`QUACKBACK_ROLE=web` does not start the tier.

## 9. Tenant scope, and the shape this must not reproduce

A BullMQ `Worker` constructed inside a request's tenant scope **inherits that
scope for every job it ever processes** — the constructor captures the
AsyncLocalStorage context, and the queue modules that armed lazily on first
enqueue armed inside whatever request reached them first. Measured on the
BullMQ side with real Redis. No such module remains; the import hazard below
is what outlived them.

This queue does not have that shape, and it is worth being precise about why
rather than asserting it:

- **`tier.ts` opens a fresh `withTenantScopeById(...)` around every pass.** The
  scope a handler runs in belongs to the pass that is running it. There is no
  long-lived worker object holding one.
- **The heartbeat timer is created inside that scope and cleared before the pass
  ends**, so it inherits the scope of its own job — which is correct — and cannot
  outlive it.
- **Handler modules are imported once at tier start, before any scope is open**
  (`primeJobHandlers()`). That closes the quieter version of the same risk: a
  dynamic `import()` executed inside a tenant scope would run the module's top
  level under that tenant's connection.

  **That guarantee reaches exactly as far as the static import graph, and an
  earlier version of this document overstated it.** Priming loads the handler
  _wrapper_ modules; three of them deferred their sweep modules to call
  time, which is inside the per-pass tenant scope — and `resolveHandler`'s
  warning could not see it, because it only guards the outer import. Proven on
  a live pooled fleet with a top-level probe in `sla.sweep.ts`: `(module not
imported)` after priming, then the probed tenant's id after the tier ran the
  sweep.

  Those imports are now static, and `__tests__/handler-imports.test.ts` scans
  every registered handler module and fails on a call-time `import(`. A source
  scan rather than a runtime assertion, because the property is about _when_ a
  module loaded and the module registry keeps no record of the scope it loaded
  under. `__tests__/priming.test.ts` pins the other half — that priming actually
  runs — because the scan proves only that the modules _can_ be primed.

  **The scan is one level deep, and the boundary is a cross-piece contract.** It
  reads the wrapper files, not their graph. Deepening it was measured and
  rejected: the modules those wrappers statically import carry 32 call-time
  imports across 12 files (`settings.service` 24, `conversation.service` 6,
  `pending-actions.service` 2) — ordinary lazy loading, none of it
  queue-specific. So the guarantee is: **the wrappers and their static graph load
  before any scope opens.** Deeper than that, a call-time import runs under
  whatever scope its caller has, which for a request is the _correct_ tenant; the
  hazard is only that the module is then shared process-wide, and only if it
  captured scope-dependent state at its top level.

  **That other half is `lib/server/policy/module-state/`**, the module-state
  scanner, which owns every module-scope mutable-state site it can see under
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

| queue                   | cron          | concurrency | maxAttempts | lease |
| ----------------------- | ------------- | ----------- | ----------- | ----- |
| `anon-sweep`            | `0 3 * * *`   | 1           | 3           | 60s   |
| `page-view-partitions`  | `30 2 * * *`  | 1           | 3           | 60s   |
| `sla-breach-sweep`      | `* * * * *`   | 1           | 3           | 60s   |
| `snooze-sweep`          | `* * * * *`   | 1           | 3           | 60s   |
| `workflow-sweep`        | `*/5 * * * *` | 1           | 3           | 60s   |
| `workflow-retention`    | `0 4 * * *`   | 1           | 3           | 60s   |
| `spam-retention`        | `0 5 * * *`   | 1           | 3           | 60s   |
| `analytics`             | `0 * * * *`   | 1           | 3           | 60s   |
| `events`                | —             | 5           | 6           | 60s   |
| `event-dispatch`        | —             | 5           | 10          | 60s   |
| `segment-evaluation`    | dynamic       | 2           | 3           | 60s   |
| `help-center-translate` | —             | 1           | 3           | 120s  |
| `email-imap`            | `* * * * *`   | 1           | 1           | 60s   |
| `workflow-dispatch`     | —             | 1           | 3           | 60s   |
| `workflow-wait`         | —             | 4           | 3           | 60s   |
| `import`                | —             | 2           | 1           | 60s   |
| `export`                | —             | 1           | 1           | 60s   |

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
late. Observed live on the first cohort: a tenant whose loop sat inside a 125 s
drain had its 11:10 slot **simply absent**, and took every slot after.

That was negligible while every sweep was sub-second. It stopped being
negligible with `help-center-translate`, whose lease is 120 s.

**The tier now runs a bounded worker pool.** `dispatchPass` claims what the pool
has room for, starts it, and returns; the loop's next act is the schedule tick,
so a running job never stands between a per-minute sweep and its slot. Three
shapes were available and the other two were rejected for reasons worth keeping:

- **Per-queue loops** multiply the poll traffic by the queue count against a
  per-tenant database. One loop keeps one poll and one claim query per pass
  whatever the queue count.
- **A separate tier for the slow queues** splits the deployment on a property
  ("slow") that is not stable — an AI call's duration is not a queue attribute.
- **One undifferentiated pool** loses the reference's per-queue `concurrency`,
  and one of those numbers is load-bearing: `workflow-dispatch` is 1 because it
  is a global FIFO, not because it is slow. Two dispatch jobs in parallel
  reorder a reply and a close on one conversation.

So the cap is **per queue**, the claim asks for exactly the free slots each
queue has (one `LATERAL` query), and each queue's rows are leased for that
queue's own lease rather than the batch's longest.

Measured once (the harness has since been removed) on a fixture where one queue
holds a 120 s job while a per-minute schedule ticks alongside it:

| drain shape                 | slow-queue runs | per-minute slots enqueued |
| --------------------------- | --------------- | ------------------------- |
| serial (the first cohort's) | 1               | **2 of 4**                |
| bounded pool (shipped)      | 1               | **3 of 3**                |

The serial column is the control: it is the shipped loop with the pool awaited
before it comes round again — literally what `drainOnce` did — and it reproduces
the dropped slots rather than asserting them. `__tests__/runner.test.ts`'s
bounded-pool suite pins the same property: dispatch returns while the work
runs, per-queue caps hold, and the FIFO queue never has two in flight.

`JOB_MAX_CONCURRENCY` caps one tenant loop's total in-flight jobs. It defaults
to the **sum of every definition's `concurrency`**, which is exactly what the
reference allowed (one `Worker` per queue at its own concurrency), so the
default binds nothing. It exists because a pooled process runs one loop per
tenant, and an operator sizing connections cares about the product.

### What the move fixed rather than preserved

- **`workflow-dispatch`'s dedupe never worked.** The comment promised that
  re-enqueuing an event deduped on `workflow-dispatch:${event.id}`. bullmq
  rejects a custom id containing `:` unless it splits into exactly three parts,
  and that key is two, so every enqueue threw `Custom Id cannot contain :` and
  the trigger was retried to exhaustion. A `dedupe_key` column has no such rule.
  (The same defect hit `workflow-wait:${runId}`, the legacy two-part key a run
  parked before waits were sequence-keyed still used.)
- **Redis held every tenant's payloads in one un-namespaced list per queue.**
  Its shared connection set no key prefix and every queue name was a
  compile-time constant, so any consumer that ever attached would drain all
  tenants from one list with no tenant discriminator. The queue table lives in the tenant's own
  database, and the claim asserts the row's stamp against the ambient scope.
- **Readiness could not see a missing consumer.** `ok = failed === 0` over
  eagerly-initialised workers reported `workers ok:true total:0` on a replica
  that had constructed none, because a worker never built is not _failed_. A
  worker-role process whose tier is not running is now unready, and the payload
  reports how many tenant loops it is serving.
- **`segment-evaluation`'s schedules stopped being a second copy.** They were
  repeatable jobs written into Redis, which had to be _restored_ at boot in case
  Redis had been cleared. They are now derived from `segments` rows on every
  tick, so there is no scheduler state to lose and nothing to reconcile.

### Measured against the reference

Before the cutover, one driver script ran the real producers against a single
seeded database under each consumer in turn — the BullMQ worker registry on the
reference build, this tier on this branch — and read the rows a caller would
poll. Import and export reached the same terminal status with the same posts
visible and equivalent export sizes, and the `events` queue published the same
outbox rows leaving none unpublished. The harness is gone; the like-for-like
suites under `__tests__/` (notably `migrated-queues.test.ts`) are what hold the
behaviour now.

One lesson from that run outlives the harness: a Postgres queue has no
per-consumer namespace, so **any process pointed at the database is a
consumer** — a leftover dev server can drain the queue it is pointed at. That
is the same property that makes the queue per-tenant, seen from the other side.

### Nothing is still Redis

The queues came here; the generic cache, rate limiting, pub/sub, presence,
visitor hashing and link previews went to `kv/` (see `kv/KV.md`). The final
cutover has since run: `ioredis` is no longer a dependency, `REDIS_URL` is no
longer read, and no service provisions a Redis. An eslint restricted-import
guard keeps the queue package out.

**`email-imap` refuses to schedule under pooled tenancy** and says so at error.
Its mailbox is process-wide configuration while the queue is per tenant, so
scheduling it on every tenant's loop would have each tenant poll the _same_
mailbox and ingest the same message into its own database. Not a regression: the
BullMQ worker was never started under pooled tenancy either.

**Domain events are dispatched through this queue.** `emit()` writes an
`event-dispatch` job in the same transaction as the outbox row. The former
relay is gone; see `events/RELAY.md`. Leftover `dispatch_owner = relay` rows
are converted onto the job path at job-tier / scheduler start.

## 11. The evidence

Everything above is pinned by the vitest suites in `__tests__/`, which run
against a real Postgres database:

- `job-queue.test.ts` — the lease contract end to end: attempts incremented at
  claim, the reaper's requeue/terminate split, the fencing token, concurrent
  claimers, the per-queue claim cap, the lease-shape `CHECK`, and the tenant
  assertion.
- `runner.test.ts` — the scheduler (adopt-at-boot, no backfill, per-tenant
  state, next-slot sleeping, gating and dynamic schedules) and the bounded pool
  (non-blocking dispatch, per-queue caps, terminal errors, the failure hook).
- `cron.test.ts` / `cron-dst.test.ts` — five-field parsing that throws on
  anything else, the slot search, and both daylight-saving transitions tick by
  tick.
- `deadlines.test.ts` — the cron gate's fail-safe direction and the slot memory
  a gated-off schedule must keep.
- `handler-imports.test.ts` / `priming.test.ts` — no call-time `import(` in a
  registered handler module, and priming actually runs before any scope opens.
- `migrated-queues.test.ts` — at-most-once stated at the enqueue sites, and the
  `email-imap` schedule gate.
- `registry-doc.test.ts` — the §10 queue table is generated from
  `JOB_DEFINITIONS` and compared cell for cell, so this document cannot drift
  from the registry.

# The Postgres job queue

Background work on Postgres, per tenant, with leases. This is the substrate that
replaces Redis for the background tier (`SAAS-HOSTING-STACK.md` §7).

`QUACKBACK_TENANCY=single` — the default and every self-hosted install — gets one
loop, no tenant scope, and the same seven sweeps on the same cadences they have
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

## 4. The tenant boundary

The queue is per-tenant **because the table lives in the tenant's own database**.
There is no shared queue, so there is no routing decision to get wrong and no
tenant parameter on `enqueueJob` — to enqueue for a tenant you must be in that
tenant's scope, at which point you are writing into its database.

That is a structural argument, and §3 of the plan is precisely the observation
that a wrong-tenant answer passes every structural check without erroring. So the
structure is not trusted on its own:

- every row is stamped with the tenant that enqueued it;
- **every claim asserts that stamp against the ambient scope**, and a mismatch is
  refused loudly and made terminal — never executed;
- the assertion lives inside `claimJobs`, not in each caller, so there is no
  version of "forgot to assert".

Demonstrated on a live two-tenant fleet with a database per tenant
(`scripts/job-tenant-proof.ts run`): jobs enqueued for each tenant executed only
against that tenant's own database (confirmed by `neon.branch_id`, not by name),
zero cross-tenant observations in both orderings, and a row planted in one
tenant's queue but stamped for the other was refused:

```
job REFUSED: row tenant does not match the tenant scope that claimed it
last_error = tenant mismatch: row is stamped inst_…bravo, scope is inst_…alpha
```

## 5. The wake, and the connection it needs

A trigger NOTIFYs `quackback_job_wake` on any write that leaves a row runnable
now. A listener on a session-mode connection wakes in milliseconds instead of
waiting out the poll interval.

**`LISTEN` does not survive a transaction-mode pooler, and the obvious health
check lies about it.** Measured on Neon for this channel, on two tenants:

| endpoint | notify actually delivered | `pg_listening_channels()` says |
| -------- | ------------------------- | ------------------------------ |
| direct   | **yes**                   | no                             |
| pooled   | **no**                    | **yes**                        |

The catalogue view is not merely a false green here — on this measurement it is
_inverted_, reporting the registration on the connection that never delivers and
not on the one that does. (The mechanism is connection multiplexing:
`postgres.js` puts `LISTEN` on its own connection, which the pooler may or may
not share with the query asking the question.) So:

- the listener is built from the tenant's **direct** DSN, never from the pool
  cache — the same shape `events/relay-lock.ts` already uses;
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

### The scheduler's memory is per tenant, and that is structural

`ScheduleState` is created by each tenant loop and **passed in**. It was a
module-scope `Map` keyed on the schedule name, and that is a cross-tenant defect:
one process runs one loop per tenant, so whichever tenant reached a slot first
advanced a counter every other tenant then read as "already done". Measured live
on two Neon tenants, each minute's sweep landed on exactly one of them. It
affected all seven sweeps, and only `page-view-partitions` had a backstop.

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
still does not run that day. That is what cron does, and the boot-time partition
ensure covers the one schedule it affects.

## 7. Shape of the tier

`tier.ts` runs **one loop per tenant**, each with its own listener.
`tenancy/fleet.ts` already answers "iterate all tenants per tick", and that is the
right answer for a periodic sweep and the wrong one for a queue: the latency of an
on-demand job would become the tick interval times the tenant count, and the whole
point of the doorbell is that a job enqueued now starts now.

The cost is one session-mode connection per tenant, permanently. That is the tier
§7.3 describes — always warm, direct connections, physically separate from the
pooled web tier — and it carries §6's corollary: **this tier holds connections
open by design, so it must never share a compute with tenants you expect to
suspend.** Sizing it for a large fleet belongs with the relay-tier work.

A tenant whose database has not yet run migration `0253` is **skipped with a
warning**, not crash-looped. §5's ordering rule is that expand lands before the
code that reads it; a queue tier that died on a mid-rollout fleet would turn that
ordering into an outage.

## 8. Configuration

Read from `process.env` directly rather than through the zod config, matching
`queue/role.ts`: these must work in any context, including a worker process that
has not loaded the full application config.

| Variable               | Default | Meaning                                                             |
| ---------------------- | ------- | ------------------------------------------------------------------- |
| `JOB_POLL_INTERVAL_MS` | 1000    | Poll fallback. The correctness floor when a NOTIFY is lost          |
| `JOB_BATCH_SIZE`       | 5       | Jobs claimed per drain pass                                         |
| `JOB_REAP_INTERVAL_MS` | 15000   | How often expired leases are adjudicated                            |
| `JOB_RETENTION_MS`     | 7 days  | How long terminal rows are kept. Must exceed any live cron slot key |

`QUACKBACK_ROLE=web` does not start the tier, the same gate `startOutboxRelay`
uses.

## 9. Tenant scope, and the shape this must not reproduce

A BullMQ `Worker` constructed inside a request's tenant scope **inherits that
scope for every job it ever processes** — the constructor captures the
AsyncLocalStorage context, and seven queue modules arm lazily on first enqueue.
Measured on the BullMQ side with real Redis.

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
  level under that tenant's connection. A miss on the memo still resolves, but
  logs, because a miss in a running tier means exactly that is happening.

## 10. What runs here, and what does not yet

On the Postgres queue: `anon-sweep`, `page-view-partitions`, `sla-breach-sweep`,
`snooze-sweep`, `workflow-sweep`, `workflow-retention`, `analytics` — the seven
§7.1 calls "already-solved shape". Their handlers are unchanged; only the queue
mechanism moved out of each module and into one registry.

Still on BullMQ, so **Redis cannot be removed yet**: `events`,
`segment-scheduler`, `help-center-translate`, `email-imap`, `workflow-dispatch`,
`workflow-wait`, `import`, `export`. `queue/worker-registry.ts` remains their one
list.

Two of those eight are the reason this primitive was built the way it was.
`import` and `export` are the at-most-once cases; when they move, they take
`maxAttempts: 1` and the reaper's terminal branch is what preserves their
semantics. Nothing else needs to change for them.

## 11. Running the evidence

```bash
# lease semantics, kill at every stage, with the positive control
DATABASE_URL=... bun run scripts/job-lease-proof.ts kill-matrix

# a job held across minutes of work with no transaction open, then SIGKILL
DATABASE_URL=... bun run scripts/job-lease-proof.ts long-lease --work-seconds 180

# wake latency, measured through the real tier
DATABASE_URL=... bun run scripts/job-lease-proof.ts wake-latency --samples 24
JOB_WAKE_DISABLED=1 DATABASE_URL=... bun run scripts/job-lease-proof.ts wake-latency --samples 24

# the tenant boundary, on a real pooled fleet
env $(cat pooled.env) bun run scripts/job-tenant-proof.ts run --a <id> --b <id>
env $(cat pooled.env) bun run scripts/job-tenant-proof.ts listen-endpoints
```

# The outbox relay tier

The relay drains the `events` outbox and is **the sole enqueuer** for the
highest-volume queue. This document is about where it runs, not about what a
drain does — that lives in `relay.ts` and has not changed.

`SAAS-HOSTING-STACK.md` §7.3.

---

## 1. What was wrong, and it was not a rough edge

Under `QUACKBACK_TENANCY=pooled` the relay was **entirely non-functional**.

It is a single-database subsystem end to end: five module-scope variables
(`running`, `leadership`, `pollTimer`, `retryTimer`, `draining`) each described
one database's relay, and `tryAcquireRelayLeadership()` opened its connection
from `config.databaseUrl` — which does not exist under pooled tenancy. Started
anyway, it entered a **silent 15-second retry loop delivering nothing**: the
leadership attempt threw, the error was caught and logged, and the loop
rescheduled itself forever. No workspace's outbox was ever drained and the only
evidence was a repeating error nobody reads as _"eventing is off"_.

It was then made to refuse loudly at boot instead. That was the right answer
while there was no fan-out. This is the fan-out.

## 2. Shape

`relay-tier.ts` runs **one loop per workspace**. Each loop owns:

|                                  |                                          |
| -------------------------------- | ---------------------------------------- |
| a **direct** (session-mode) pool | one connection, `idle_timeout: 0`        |
| a **direct** doorbell            | `LISTEN outbox_wake`, its own connection |
| a **leadership lease**           | a row in that workspace's own database   |
| its counters                     | in the closure, not in a shared map      |

Two sockets per workspace, both session-mode, both to the workspace's own database.
Nothing is shared between loops, so there is no object left for a second workspace
to key wrongly.

`tenancy/fleet.ts` already answers _"iterate all workspaces per tick"_, and that is
the right answer for a periodic sweep and the wrong one for a relay: the latency
of an event would become the tick interval times the workspace count, and the whole
point of the doorbell is that an event committed now drains now. So the fleet
iteration is reduced to **discovering** workspaces, refreshed every 60s.

**Single-workspace installs are unchanged in shape.** One loop, no workspace scope,
`DATABASE_URL` — which for a self-hosted install already is a direct session-mode
connection. They also lose one dedicated connection, because the lease replaces
the advisory lock's connection.

## 3. Why the connections are direct, and why the obvious check lies

`LISTEN` needs a session-mode connection. Measured on Neon for **this** channel,
across six workspace databases, with delivery as the instrument:

| endpoint | NOTIFY actually delivered |
| -------- | ------------------------- |
| direct   | **6 / 6**                 |
| pooled   | **0 / 6**                 |

Through a transaction-mode pooler a notify never arrives, and the run that went
hunting for a counter-example did not find one: **0/1 at a single idle client
across 16 runs**, with the notify issued on the pooled endpoint against a constant
notifier backend pid so same-backend routing was available, a self-notify from the
same `postgres.js` instance holding the `LISTEN`, `LISTEN "c"; NOTIFY "c";` in one
simple-protocol batch on one socket, and 25 concurrent pooled senders at one idle
listener. Zero delivered on pooled in every case.

**So this is a hard impossibility, not a loss that grows with contention.** Two
consequences: a one-connection smoke test does _not_ pass on a pooler, and
"the relay runs on direct connections" is a structural requirement rather than a
tuning preference. `direct-session.ts` names a `-pooler.` DSN before the
connection is opened for exactly that reason.

And `pg_listening_channels()` is not merely a false green here, it is _inverted_:
it reports the registration on the pooled connection that delivers nothing and not
on the direct one that does, because
`postgres.js` puts `LISTEN` on its own connection which the pooler may not share
with the query asking the question.

So the rule this tier follows, and the reason `verify()` exists:

> **Test a doorbell by sending a NOTIFY and waiting for it. Never by asking the
> catalogue whether you are registered.**

`wake.ts`'s `verify()` waits for a random `__verify__<8>` payload sent from a
_second_ connection and matched by exact equality, so its only failure mode is a
false _red_. Every workspace's doorbell is round-tripped once at boot and a failure
is logged at error naming the likely cause.

The tier does **not** borrow the request pool cache. Three reasons, the first
architectural: that cache terminates at the pooled endpoint; it is an LRU sized
for request traffic and evicts on idleness, which is exactly what an always-warm
tier must not have done to it; and §6's corollary is that this tier holds its
connections open **by design**, so it must never share a compute with workspaces you
expect to suspend — which is easier to honour when its connections are a separate,
countable thing.

What it does not do is re-implement the §3 fingerprint assertion. It calls
`openWorkspaceDirectPool`, which calls the same `verifyWorkspaceDatabase` the request
path calls. **A second copy of a fail-closed identity check is a second copy that
can drift open.**

## 4. Leadership is a lease, not an advisory lock

The relay has always elected one drainer per database. It did so with a
session-level `pg_advisory_lock`. On a direct connection that is correct. The
reason it could not stay is that its correctness is a property of the _session_,
and every one of those properties was measured to change with a pooler in the
path:

- **it fails open, non-deterministically.** A second pooled client asking for the
  same key was told `t`, because the pooler had routed it onto the _same backend_
  and it re-entered the lock. Forced onto a fresh backend, the same call
  correctly returned `false`. "Did I win the election?" had an answer that
  depended on connection routing.
- **it outlives its client.** A pooled holder that disconnected kept the lock, and
  a direct client asking for it then _blocked_ — measured dying twice on a 10s
  `lock_timeout`, recovering only after `pg_terminate_backend`.
- **the pooler runs no reset between clients**, so session state set by one client
  is read by the next.

This tier terminates at the direct endpoint, so none of that applies to it today.
**That is exactly the argument the design refuses to rely on.** A registry record
whose `db_direct_url` is in fact a pooler is a one-character mistake, and it would
silently elect two leaders for one workspace rather than failing. Correctness should
not be one config field deep.

`relay-leader.ts` replaces it with one row, one expiry, and **one statement** that
both acquires and renews:

```
INSERT … ON CONFLICT (name) DO UPDATE … WHERE owner = me OR expires_at <= now()
```

`ON CONFLICT DO UPDATE` takes a row lock, so concurrent claimers serialize and the
loser re-evaluates the `WHERE` against the winner's committed row. No session
state, so the answer cannot depend on which backend the caller landed on; a dead
leader's lease lapses on its own; a follower is told `false` immediately rather
than blocking behind a lock it will never get.

**The fence** increments on acquisition and never on renewal, so it names a
leadership epoch. A leader that stalled past its lease, was superseded, and then
resumed learns it lost — the case a lease alone cannot express, because an
owner-only check would hand it the lease back with no signal that anything
happened in between.

Draining is idempotent regardless (deterministic job ids, `published_at IS NULL`
as the read filter), so a lost fence costs a wasted pass and never a double
delivery. **The fence is what makes "two replicas do not both drain one workspace" an
observable fact rather than an inference from idempotency**, and the counters that
observe it are why the harness can tell a healthy single-leader run from a
fail-open one.

## 5. The poll interval is the correctness floor

The wait is a race between the doorbell and the poll. If the doorbell is lost — a
dropped connection, a pooled DSN, a NOTIFY that fired while nothing was listening
— the poll still fires, so **a lost wake costs latency and never correctness.**

`NOTIFY` is not durable. A payload fired while no session holds the `LISTEN` is
gone and nothing replays it, which is why the floor is not a fallback nobody
exercises. Measured against a real lost notify (the doorbell's backend terminated
for the whole window, `notifies_received=0`), every event still published.

## 6. Measured

**Which compute, and what else was on it.** The pooled arms ran against
`inst_gauntlet_neon_t1` (Neon project `ep-tiny-poetry-auqd4saj`, branch
`br-weathered-lake-aupi87in`); the single-workspace arm ran against a local
Postgres database this piece created and owns (`quackback_p9`). **The t1 compute
was shared with other pieces at the time**, which adds load but not skew — these
are latency arms, not suspend arms, and no claim here depends on the compute being
idle. A suspend measurement on that compute would have been invalid, and this
piece does not make one.

Local machine → Neon `us-east-1`, so a transatlantic round trip (~110 ms) is in
every number. On a co-located Railway `us-east4` ↔ Neon `us-east-1` deployment
the per-query RTT is 1–6 ms and both columns shrink by roughly an order of
magnitude; the _ratio_ is the transferable part.

`RELAY_POLL_INTERVAL_MS=1000`, uniform jitter in `[0, 1000)` before every sample.

| arm                               | n   | notifies | min | p50      | p95  |
| --------------------------------- | --- | -------- | --- | -------- | ---- |
| end-to-end, doorbell alive        | 24  | 25       | 586 | **889**  | 965  |
| relay half (notify → drained)     | 23  | —        | 415 | **526**  | 591  |
| end-to-end, doorbell alive        | 12  | 12       | 642 | **901**  | 1002 |
| end-to-end, notify genuinely lost | 12  | **0**    | 763 | **1121** | 1538 |

Local Postgres, single workspace, through the real tier: **33–343 ms** end to end.

**Two numbers are reported rather than one** because the end-to-end figure also
contains the emitter's own commit round trips, and a reader comparing two
deployments needs to know which half moved.

**The methodology matters more than the numbers.** Latency is recorded _inside_
`drainOnce` — this process's clock at publish minus the row's `occurred_at` — not
by whatever started the relay. A harness that resolves on
`min(NOTIFY, setTimeout(pollMs))` reports its own timer as the poll floor, and one
that emits the next sample immediately after the previous drained phase-locks
every arrival to the start of a poll window and reports the worst case as the
median.

**An earlier version of the harness had a defect worth recording**, because it is
the class this run keeps finding: it inserted the outbox row without the
commit-time `pg_notify` that `emit()` fires. Every sample then sat on the poll
floor and the run printed a plausible p50 of 1192 ms. The only thing that gave it
away was the tier reporting `wakes=1` across 24 samples. _A latency measurement
that never rings the doorbell it is measuring cannot disagree with the hypothesis
that the doorbell is slow._

### What this tier costs an idle workspace

**It keeps the compute awake, deliberately.** A loop holds two session-mode
sockets with `idle_timeout: 0` and asks for its lease at least once per poll
interval, and a ~1 Hz query against a workspace is measured to hold a Neon compute
awake indefinitely. That is §6's corollary stated as a running cost: **this tier
must never share a compute with workspaces you expect to suspend.** The pool cache's
eviction story is for the _web_ tier and does not apply here.

What the tier does owe is that it lets go completely when it stops.
`stopRelayTier()` releases each workspace's lease (so a surviving replica takes over
immediately rather than waiting out the TTL), closes the doorbell and ends the
pool. Verified by reading `pg_stat_activity` on all six workspace databases after a
run: **zero connections carrying `application_name = quackback-wake-listener`**.

That check is only possible because the doorbell connections are named. Every
other client on those computes reports as `postgres.js`, which is to say
unattributable — so naming them is what makes "who is holding this compute awake?"
an answerable question rather than a guess.

## 7. One workspace's failure never costs the fleet its relay

Every failure is per workspace, and there are three distinct shapes:

| shape                                                                           | outcome                                                                      |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| the registry refuses the record                                                 | dropped by `listActiveWorkspaces`, logged with the workspace, the rest start |
| the database refuses the fingerprint, or its credential/secret will not resolve | that loop is not started, logged with the workspace, the rest start          |
| the database predates migration `0256`                                          | the loop runs, warns **once**, and backs off — it does not crash-loop        |

A pass that threw on the first bad record would turn one wrong row in the control
plane into a fleet-wide eventing outage, which is strictly worse than the failure
it is reacting to. Observed live: two workspaces refused for an unresolvable secret
ref and two more without `0256`, while the remaining workspaces drained normally
(`started=4 refused=2 live=4`).

## 8. Where a resolved hook job goes

One sink, under either tenancy mode: `enqueueHookJobsWithIds` writes the whole
fan-out into the `events` queue on the **workspace's own Postgres job tier**. Same
database as the outbox row it came from, `workspace_key` stamped from the ambient
scope and asserted again by the claim, no routing decision to get wrong because
there is no shared queue.

**One statement, whatever the fan-out**, and that is not a throughput detail. A
crash between the enqueue and the publish stamp re-drains the row, which
re-enqueues the same deterministic ids; a single
`INSERT … ON CONFLICT (queue, dedupe_key) DO NOTHING` turns the whole repeat into
a no-op, and it does so for duplicates _within_ the batch too. A loop issuing one
insert per target gives neither: it can be interrupted half-written, and it costs
a round trip per target on the highest-volume queue in the process.

There is no longer a tenancy branch here. There was one, for as long as the sink
under single tenancy was a queue this tier could not safely share; the queue
migration removed the second sink, so the branch had nothing left to choose
between.

## 9. Configuration

Read from `process.env` directly rather than through the zod config, matching
`process-role.ts` and the job tier: these must work in any context, including a
relay process that has not loaded the full application config.

| Variable                  | Default | Meaning                                                        |
| ------------------------- | ------- | -------------------------------------------------------------- |
| `RELAY_POLL_INTERVAL_MS`  | 1000    | Poll fallback. The correctness floor when a NOTIFY is lost     |
| `RELAY_LEASE_TTL_MS`      | 30000   | How long leadership is held before another replica may take it |
| `RELAY_FOLLOWER_RETRY_MS` | 5000    | How often a follower re-asks                                   |
| `RELAY_BATCH_SIZE`        | 100     | Rows per drain pass                                            |
| `RELAY_WAKE_DISABLED`     | unset   | Diagnostics only. Never set in production                      |

`QUACKBACK_ROLE=web` does not start the tier — the same gate the job tier uses.

## 10. Running the evidence

```bash
# §7.3 re-measured for THIS channel, direct vs pooled, delivery as the instrument
env $(cat pooled.env) bun run scripts/relay-tier-proof.ts listen-endpoints

# no row dispatched against another workspace's database, both orderings
env $(cat pooled.env) bun run scripts/relay-tier-proof.ts workspace-proof --a <id> --b <id>

# leadership, and a takeover after a dead leader
env $(cat pooled.env) bun run scripts/relay-tier-proof.ts leader-proof --a <id>

# two OS processes: only one drains. Run `replica` twice, then plant and inspect
env $(cat pooled.env) bun run scripts/relay-tier-proof.ts replica --label R1
env $(cat pooled.env) bun run scripts/relay-tier-proof.ts plant   --a <id> --count 5
env $(cat pooled.env) bun run scripts/relay-tier-proof.ts inspect --a <id>

# wake latency, measured by the relay, with uniform jitter
env $(cat pooled.env) bun run scripts/relay-tier-proof.ts wake-latency --a <id> --samples 24

# the poll floor under a REAL lost notify (doorbell terminated for the window)
env $(cat pooled.env) bun run scripts/relay-tier-proof.ts poll-fallback --a <id>
```

## 11. Known open

- **The tier's status is on the readiness probe.** `health.ready.ts` requires
  the relay to be running whenever `shouldRunWorkers()` is true, and reports
  loop/attached counts next to the job tier's.
- **`RELAY_LEASE_TTL_MS` is a fleet-wide number.** A workspace whose drain
  legitimately outruns 30 s loses leadership and logs `leaseLosses`; nothing is
  lost, but the right answer is a heartbeat inside the drain rather than a larger
  constant.

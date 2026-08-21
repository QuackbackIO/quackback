# Event dispatch (the outbox relay is gone)

The outbox relay — its LISTEN loop, leader lease, and `drainOnce()` — no longer runs. Domain events are
dispatched by the Postgres job queue.

This file records that cutover; it does not define a second architecture.

## What replaced it

`emit()` writes the `events` row and an `event-dispatch` job in the
**same transaction**. The job-queue trigger NOTIFYs `quackback_job_wake`
on commit. `runEventDispatch` in `event-dispatch-queue.ts` loads the
authoritative row, resolves destinations, and enqueues hook jobs with
the same deterministic `<eventId>:<sink>:<target>` keys the relay used.

Shared helpers live in `outbox.ts`:

- `hydrateEvent`
- `MAX_DEPTH` (reaction-loop ceiling)
- `MAX_STRICT_RESOLVE_ATTEMPTS` (best-effort degradation after the job
  retry budget)

See `jobs/JOBS.md` for the remaining always-warm tier.

## What stayed, and why

- **`dispatch_owner`** remains on `events`. New rows default to `'job'`.
  Leftover unpublished `'relay'` rows are converted onto the job path at
  job-tier / scheduler start (`convertRelayOwnedEvents`) and then drained
  like any other `event-dispatch` job. The column stays for one more soak;
  it is not a feature flag.

## What was deleted

- `relay-tier.ts` — per-workspace LISTEN / poll / lease loop
- `relay-leader.ts` — lease acquire / renew / release
- `relay.ts` — `drainOnce` over `dispatch_owner = 'relay'`
- `direct-session.ts` — relay-only pooled-DSN warning
- `RELAY_*` env vars (`RELAY_POLL_INTERVAL_MS`, `RELAY_LEASE_TTL_MS`,
  `RELAY_FOLLOWER_RETRY_MS`, `RELAY_BATCH_SIZE`, `RELAY_WAKE_DISABLED`,
  `RELAY_LEASE_RENEW_MS`)
- Relay readiness fields (`relayRunning`, `relayLoops`, `relayAttached`)
- Relay startup from `startup.ts` and the internal wake route

Self-host `QUACKBACK_ROLE=all` starts the job tier only.

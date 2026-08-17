# Unified runtime — starting point

Phase 0 note for collapsing the SaaS fleet to `quackback` + `quackback-control-plane`, one Postgres `job_queue`, and no tenant connections unless a request is live or scheduled work is due.

Recorded against:

- app `/home/james/quackback-wt/saas-merge` `saas` @ `43109b1e397530167f41199bc9adf4977aad86cf` (Phase 1 landed; this file tracks the programme)
- CP `/home/james/quackback-cp` `saas` @ `51594c4f392fe75244ed6998945f28ce667f579f`
- colder-fleet spec rev 6 at `/tmp/claude-1000/-home-james-quackback/108ea693-3ede-4321-91f4-1c69c03076a1/scratchpad/colder-fleet.html`

Do not treat this file as permission to delete live Railway services. IaC may declare intent; live destroy is separately gated.

## Colder-fleet workstream map

| WS                                         | Status                                   | Evidence                                                                     | What this programme does with it                                                        |
| ------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0.1 preserve() vars                        | **landed** (not the live hazard anymore) | `2e6624280`; `railway config plan` was clean                                 | Keep                                                                                    |
| 0.2 cron :00 + CP us-east4                 | **landed + deployed/proven**             | live cron `0 * * * *`; CP region us-east4                                    | Keep                                                                                    |
| 0.3 / 0.4 dead fleet                       | **deployed/proven**                      | 9 Neon projects (8 workspaces + control DB)                                  | Keep                                                                                    |
| 0.5 baseline                               | **recorded**                             | ~62–69% lifetime duty before cleanup                                         | Re-measure after this work                                                              |
| 0.6 docs                                   | **landed**                               | `e7fea3b25`                                                                  | Keep                                                                                    |
| 1 grid-snap + fast-detach                  | **landed, not deployed**                 | `159eae03f`, `7904f57ee`                                                     | **Superseded** by Phase 3 (delete rescan). Leave until scheduler is proven, then delete |
| 1.4 connection audit / SSE                 | **landed, not deployed**                 | `765431326`, CP `e1e28b7`                                                    | Keep SSE teardown; LISTEN/direct pools go away in Phases 2–3                            |
| 2 housekeeping job                         | **landed, not deployed**                 | `decab0d0f`, `938e79dbd`. Live image still old digest — do not apply env yet | Phase 6: keep job body, delete cron services only after replacement + approval          |
| 3 migrator entrypoint                      | **landed, not deployed**                 | `7ac4e4b55`                                                                  | Keep                                                                                    |
| 4 membership skip suspended                | **landed, not deployed**                 | CP `abefa938`                                                                | Phase 5 replaces the remaining fan-out with `membership-sync`                           |
| 5.1 PG locks/limits                        | **landed, not deployed**                 | CP `36565cc`                                                                 | Keep. Complements “no Redis”                                                            |
| 5.2 BullMQ dispatch                        | **landed** (not deployed)                | CP `51594c4`                                                                 | Keep. Redis service still live until stop-and-ask                                       |
| 5.3 delete Redis                           | **not started** (stop-and-ask)           | Redis still live                                                             | Phase 6 / later, after approval                                                         |
| 6 HTTP nudge                               | **deleted**                              | route + `wake-nudge.ts` removed; after-commit sinks only                     | Cloud is `ROLE=all`; no worker to nudge                                                 |
| 7 4h rescan / membership push / duty stats | **not started**                          | —                                                                            | **Do not implement.** No blind rescan; membership is Phase 5 jobs                       |
| 8 per-tenant sweeps off cron               | **not started**                          | —                                                                            | Compatible; can land later without a worker                                             |
| 9 delete cron / daily stage                | **not started**                          | —                                                                            | Phase 6, after replacements exist                                                       |

Dirty tree noise (`loop-evidence/`, `COLDER-FLEET-SPEC.html`, prompts) is someone else’s. Never stage it.

## Live Railway (verified 2026-08-17)

| Service                   | Live now                                                                | Runs |
| ------------------------- | ----------------------------------------------------------------------- | ---- |
| `quackback`               | `QUACKBACK_ROLE=all` + `QUACKBACK_WAKE_MODE=scheduler`; no LISTEN loops | 1    |
| `quackback-control-plane` | provisioning, billing; membership sweep is owner-seat only              | 1    |
| `quackback-cron-hourly`   | `QUACKBACK_CRON_JOB=housekeeping`                                       | cron |
| `quackback-cron-daily`    | leftover; housekeeping should replace                                   | 0    |
| `quackback-migrator`      | leftover; housekeeping enrols+runs                                      | 0    |
| Redis                     | leftover; CP dispatch is in-process                                     | 1    |

`quackback-worker` has been deleted. All remaining services are in `us-east4-eqdc4a`. Cron/migrator/Redis stay until a green housekeeping history plus a later apply.

## Producers

**Domain events** — only `emit()` / `emitBestEffort()` (`events/emit.ts`). Callers include api-keys, boards (`emitBestEffort`), companies, conversation + ticket webhook helpers, plus `processEvent`’s outbox write path. `emit()` INSERTs `events` + optional `audit_log` + an `event-dispatch` job on the caller’s tx. The job-queue trigger NOTIFYs `quackback_job_wake` on commit.

**Jobs** — `enqueueJob` / `enqueueJobs` (`job-queue.ts`). Domain: import, export, help-center-translate, workflow-dispatch, workflow-wait. Relay: `enqueueHookJobsWithIds`. Cron/schedule ticks enqueue via the job tier. A table trigger NOTIFYs `quackback_job_wake` on commit of a runnable row.

**Scheduled deadlines** — job-tier `cron` + `cronEnabled` (`sla-breach-sweep`, `snooze-sweep`, others in `definitions.ts`); `earliestPendingJobAt` + `earliestWorkspaceDeadline()` providers; delayed `events` jobs (`addDelayedJob`).

**Membership changes** — workspace invite/accept/remove/role/owner paths enqueue `membership-sync` on the per-tenant job_queue (after-commit). The handler reads this workspace's team (`principal.type='user'` and role in admin/member) and pushes the desired set to the control plane. Self-host without `QUACKBACK_CONTROL_PLANE_URL` is a successful no-op. Owner seat on create stays (`recordOwnerSeat`).

## Connection classes (today)

| Class                 | Where                                              | Idle behaviour                                                                                        |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Request pooled        | `pool-cache.ts`                                    | `idle_timeout` 45s + LRU evict                                                                        |
| Job scheduler         | `jobs/scheduler.ts`                                | no tenant connection; Node timers only. Cloud `quackback` uses this (`WAKE_MODE=scheduler`)           |
| Job LISTEN            | `jobs/wake.ts` + `jobs/tier.ts`                    | session-mode, `idle_timeout: 0`, closed on detach. Default / self-host; not used on cloud `quackback` |
| App control-DB        | `workspaces/registry.ts`                           | `idle_timeout` ≈ TTL+15s                                                                              |
| CP `DATABASE_URL`     | CP `src/db`                                        | `idle_timeout` default 10s                                                                            |
| CP membership clients | ~~`workspace-membership-sweep.ts` tenant fan-out~~ | Removed. The 15-min registrar restamps owner seats from CP columns only and does not open tenant DBs. |
| SSE / realtime        | `pubsub.ts`, `pg-listener.ts`                      | presence-only no longer LISTENs; heartbeat tears abandoned streams                                    |
| Migrator / admin      | `fleet/migrator.ts`                                | one-shot `max:1`                                                                                      |

## What this programme will not do

- Duplicate WS-5.2 while the other agent is writing the CP.
- Land WS-7’s 4-hour rescan or Neon activity oracle.
- “Fix” the WS-6 wake 404 as a permanent architecture (the route is deleted).
- Destroy live Railway services without an explicit yes.
- Merge CP privileges into the app, or collapse tenant DBs.

## Phase order from here

1. **Landed.** Transactional `enqueueJob` + `event-dispatch` + `dispatch_owner` (relay still drains `relay`-owned rows).
2. **Landed.** Relay subsystem deleted. Job path is the only drain. `dispatch_owner` and `outbox_relay_leader` stay for soak / rollback.
3. **Landed.** After-commit signals + one process scheduler (`QUACKBACK_WAKE_MODE=listener|both|scheduler`, default `listener`). LISTEN/poll/rescan stay until `scheduler` has soaked.
4. **This commit.** Scheduler on tenant-facing `quackback` (`ROLE=all`, `WAKE_MODE=scheduler`). HTTP wake deleted. `quackback-worker` stays declared so `plan` is variable changes, not a destroy. Live delete is a later apply after soak.
5. **Landed.** `membership-sync` job; CP sweep no longer opens tenant DBs.
6. Remove cron/migrator resources only after replacements have a green run + approval.

### Temporary flags

| Flag                  | Values                                               | Rollback                               | Progress metric                                                            | Delete when                                  |
| --------------------- | ---------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| event ownership       | `dispatch_owner=relay\|job` (row marker, not an env) | leftover `relay` rows stay unpublished | unpublished `relay` rows age out                                           | drop column after soak                       |
| `QUACKBACK_WAKE_MODE` | `listener` (default) / `both` / `scheduler`          | unset / `listener` on `quackback`      | scheduler-only: no `LISTEN` in `pg_stat_activity`, jobs still meet latency | after soak; self-host unset stays `listener` |
| unified runtime       | `quackback` `ROLE=all` + `WAKE_MODE=scheduler`       | keep the worker service declared       | one `quackback` replica runs the scheduler                                 | live worker delete, after soak + approval    |

## Crash window and fleet size

There is a process-local window between commit and the after-commit callback. Startup recovery (`recoverPendingWork`) enumerates active workspaces once, with `JOB_STARTUP_SCAN_CONCURRENCY` (default 4). It is not repeated.

Revisit this when **startup exceeds ~30s** or the **active fleet exceeds ~200 workspaces**. At that point an external durable scheduler (still not a second queue) may be cheaper than a boot scan. Current fleet is under 20 workspaces.

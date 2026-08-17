# Unified runtime — starting point

Phase 0 note for collapsing the SaaS fleet to `quackback` + `quackback-control-plane`, one Postgres `job_queue`, and no tenant connections unless a request is live or scheduled work is due.

Recorded against:

- app `/home/james/quackback-wt/saas-merge` `saas` @ `4a1efa0678e68890b46ece07fa5db58d59bc5071`
- CP `/home/james/quackback-cp` `saas` @ `36565cc8be20b34dda9934db9baf7cfeae95ff61`
- colder-fleet spec rev 6 at `/tmp/claude-1000/-home-james-quackback/108ea693-3ede-4321-91f4-1c69c03076a1/scratchpad/colder-fleet.html`

Do not treat this file as permission to delete live Railway services. IaC may declare intent; live destroy is separately gated.

## Colder-fleet workstream map

| WS                                         | Status                                   | Evidence                                                                            | What this programme does with it                                                                                              |
| ------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 0.1 preserve() vars                        | **landed** (not the live hazard anymore) | `2e6624280`; `railway config plan` was clean                                        | Keep                                                                                                                          |
| 0.2 cron :00 + CP us-east4                 | **landed + deployed/proven**             | live cron `0 * * * *`; CP region us-east4                                           | Keep                                                                                                                          |
| 0.3 / 0.4 dead fleet                       | **deployed/proven**                      | 9 Neon projects (8 workspaces + control DB)                                         | Keep                                                                                                                          |
| 0.5 baseline                               | **recorded**                             | ~62–69% lifetime duty before cleanup                                                | Re-measure after this work                                                                                                    |
| 0.6 docs                                   | **landed**                               | `e7fea3b25`                                                                         | Keep                                                                                                                          |
| 1 grid-snap + fast-detach                  | **landed, not deployed**                 | `159eae03f`, `7904f57ee`                                                            | **Superseded** by Phase 3 (delete rescan). Leave until scheduler is proven, then delete                                       |
| 1.4 connection audit / SSE                 | **landed, not deployed**                 | `765431326`, CP `e1e28b7`                                                           | Keep SSE teardown; LISTEN/direct pools go away in Phases 2–3                                                                  |
| 2 housekeeping job                         | **landed, not deployed**                 | `decab0d0f`, `938e79dbd`. Live image still old digest — do not apply env yet        | Phase 6: keep job body, delete cron services only after replacement + approval                                                |
| 3 migrator entrypoint                      | **landed, not deployed**                 | `7ac4e4b55`                                                                         | Keep                                                                                                                          |
| 4 membership skip suspended                | **landed, not deployed**                 | CP `abefa938`                                                                       | Phase 5 replaces the remaining fan-out with `membership-sync`                                                                 |
| 5.1 PG locks/limits                        | **landed, not deployed**                 | CP `36565cc`                                                                        | Keep. Complements “no Redis”                                                                                                  |
| 5.2 BullMQ dispatch                        | **in progress** (other agent on CP)      | do not edit CP until that lands                                                     | Reconcile; do not duplicate                                                                                                   |
| 5.3 delete Redis                           | **not started** (stop-and-ask)           | Redis still live                                                                    | Phase 6 / later, after approval                                                                                               |
| 6 HTTP nudge                               | **landed, not deployed; critic FAIL**    | wake route not in `FLEET_PATHS` (404 on worker Host); `emit()` nudges inside the tx | **Do not fix-forward as a permanent path.** Phase 3 after-commit + in-process scheduler replace it; Phase 4 deletes the route |
| 7 4h rescan / membership push / duty stats | **not started**                          | —                                                                                   | **Do not implement.** No blind rescan; membership is Phase 5 jobs                                                             |
| 8 per-tenant sweeps off cron               | **not started**                          | —                                                                                   | Compatible; can land later without a worker                                                                                   |
| 9 delete cron / daily stage                | **not started**                          | —                                                                                   | Phase 6, after replacements exist                                                                                             |

Dirty tree noise (`loop-evidence/`, `COLDER-FLEET-SPEC.html`, prompts) is someone else’s. Never stage it.

## Live Railway (unchanged this phase)

| Service                   | Role today                                                  | Runs                             |
| ------------------------- | ----------------------------------------------------------- | -------------------------------- |
| `quackback`               | `QUACKBACK_ROLE=web`, enqueue-only                          | 1                                |
| `quackback-worker`        | job tier + relay, LISTEN + rescan                           | 1                                |
| `quackback-control-plane` | provisioning, billing, membership sweep                     | 1                                |
| `quackback-cron-hourly`   | fleet sweeps (live still `hourly`; IaC says `housekeeping`) | 1 (stuck/listening on old image) |
| `quackback-cron-daily`    | retention + telemetry                                       | 0                                |
| `quackback-migrator`      | schema convergence                                          | 0                                |
| Redis                     | CP BullMQ + leftover `REDIS_URL`                            | 1                                |

All in `us-east4-eqdc4a`. Target end state: `quackback` + `quackback-control-plane` only.

## Producers

**Domain events** — only `emit()` / `emitBestEffort()` (`events/emit.ts`). Callers include api-keys, boards (`emitBestEffort`), companies, conversation + ticket webhook helpers, plus `processEvent`’s outbox write path. `emit()` INSERTs `events` + optional `audit_log` on the caller’s tx, then `pg_notify('outbox_wake')` and `nudgeWorker()` (the latter is inside the tx today).

**Jobs** — `enqueueJob` / `enqueueJobs` (`job-queue.ts`). Domain: import, export, help-center-translate, workflow-dispatch, workflow-wait. Relay: `enqueueHookJobsWithIds`. Cron/schedule ticks enqueue via the job tier. A table trigger NOTIFYs `quackback_job_wake` on commit of a runnable row.

**Scheduled deadlines** — job-tier `cron` + `cronEnabled` (`sla-breach-sweep`, `snooze-sweep`, others in `definitions.ts`); `earliestPendingJobAt` + `earliestWorkspaceDeadline()` providers; relay `earliestUndeliveredOutboxAt`; delayed `events` jobs (`addDelayedJob`).

**Membership changes** — workspace invite/accept/remove/role paths (app). CP still _pulls_ seats every 15 min via `workspace-membership-sweep.ts` (WS-4 skips suspended/provisioning). No durable push job yet.

## Connection classes (today)

| Class                 | Where                           | Idle behaviour                                                                                   |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Request pooled        | `pool-cache.ts`                 | `idle_timeout` 45s + LRU evict                                                                   |
| Job LISTEN            | `jobs/wake.ts` + `jobs/tier.ts` | session-mode, `idle_timeout: 0`, closed on detach                                                |
| Relay LISTEN          | `relay-tier.ts`                 | same                                                                                             |
| Relay direct pool     | `openWorkspaceDirectPool`       | `max:1`, `idle_timeout: 0`, closed on detach                                                     |
| App control-DB        | `workspaces/registry.ts`        | `idle_timeout` ≈ TTL+15s                                                                         |
| CP `DATABASE_URL`     | CP `src/db`                     | `idle_timeout` default 10s                                                                       |
| CP membership clients | `workspace-membership-sweep.ts` | `max:1`, `idle_timeout:5`, `end()` in finally; still fans out to every _active_ tenant each tick |
| SSE / realtime        | `pubsub.ts`, `pg-listener.ts`   | presence-only no longer LISTENs; heartbeat tears abandoned streams                               |
| Migrator / admin      | `fleet/migrator.ts`             | one-shot `max:1`                                                                                 |

## What this programme will not do

- Duplicate WS-5.2 while the other agent is writing the CP.
- Land WS-7’s 4-hour rescan or Neon activity oracle.
- “Fix” the WS-6 wake 404 as a permanent architecture (the route is deleted in Phase 4).
- Destroy live Railway services without an explicit yes.
- Merge CP privileges into the app, or collapse tenant DBs.

## Phase order from here

1. Transactional `enqueueJob` + `event-dispatch` + `dispatch_owner` compatibility (relay still drains `relay`-owned rows).
2. After soak: delete the relay subsystem.
3. After-commit signals + one process scheduler; then delete LISTEN/poll/rescan.
4. Run scheduler in `quackback` (`ROLE=all`); prepare IaC to drop the worker (live delete gated).
5. `membership-sync` job; delete CP tenant fan-out.
6. Remove cron/migrator resources only after replacements have a green run + approval.

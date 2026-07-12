# EVENTING-V2-SPEC.md — Durable Event Spine, Catalogue, Resolver Registry & App Platform

Status: DRAFT (2026-07-12). Owner: platform. Target branch: `next`.

This spec turns the "missing spine, not missing hooks" design review into an executable,
work-order-decomposed plan. Each work order (WO) is a self-contained card sized to one focused
PR and written so a fresh Sonnet 5 subagent with **no prior context** can execute it. Read
§2 (normative contracts) and §5 (parallelization) before starting any WO.

---

## 1. Context, Goals, Non-Goals

### 1.1 The problem (verified ground truth)

- **Durability hole.** `dispatchEvent()` (`apps/web/src/lib/server/events/dispatch.ts`) is
  fire-and-forget _after_ commit: a crash between DB commit and the `{event-hooks}` BullMQ enqueue
  silently drops the event. Already observed; patched only for workflow triggers
  (`domains/workflows/workflow-dispatch-queue.ts`) — still Redis, still post-commit. No outbox.
- **Coverage by memory.** Only 8 of ~40 entity families emit anything (post, comment,
  changelog[publish-only], status, conversation, message, ticket, sla/assistant). Emission is 100%
  manual/scattered. Silent: boards, votes, principals, RBAC roles, companies, teams, segments, tags,
  categories, saved views, roadmap, KB articles, api-keys, reactions, moderation/flags, subscriptions,
  settings, macros, channel-accounts, connectors, integrations-as-entities, import-runs,
  merge-suggestions, attribute-definitions.
- **Monolith resolver.** `getHookTargets()` (`events/targets.ts`, 1251 lines) is a fixed if-ladder
  with hardcoded per-event-type constant arrays. Adding a sink _category_ means central surgery.
  (The layer beneath — `HookHandler` + `registry.registerHook` + `integration_event_mappings` +
  `hook_deliveries` — is already data/registration-driven and correct.)
- **Underused crown jewel.** Quackback is already a spec-compliant OAuth 2.1 authorization server
  (better-auth `oauthProvider`), sharing one scope vocabulary across REST, MCP, OAuth. Today it only
  authorizes MCP clients; first-party integrations remain a hardcoded `Map`
  (`integrations/index.ts`).

### 1.2 Goals

1. Close the durability hole with a **transactional outbox** (one new table) drained by a
   worker-role **relay** into the existing `{event-hooks}` fan-out. Zero external behavior change at
   Phase 0.
2. Make coverage a **CI-enforced checklist** (a catalogue + a test), not an ORM trick. Explicit,
   semantic emission at call sites via a thin `emit(tx, ...)`.
3. Replace the `getHookTargets()` if-ladder with a **resolver registry** — each sink kind registers
   `{ interestedIn, resolve }`; sink-owned storage stays sink-owned.
4. One **event catalogue**: `<entity>.<verb>`, zod payloads, one `defineEvent` declaration that feeds
   webhooks + workflow triggers + notification matrix keys + OpenAPI, killing the ~5-file edit and the
   "webhook advertises 4 events, supports 30" drift.
5. Bind third-party extension to the **OAuth app platform** (scope-gated event subscriptions + signed
   webhook delivery), and **fold first-party integrations into it**.
6. **Cut over every existing consumer** onto the new spine and **delete the legacy path entirely**
   (Phase 5).

### 1.3 Non-Goals (verbatim from the review — do NOT build these)

- **Event sourcing.** Domain tables remain the source of truth; events are notifications with
  snapshots. Never rebuild state from the log.
- **CDC / logical decoding.** Would demand `wal_level=logical` + replication slots from self-hosters
  on managed Postgres; and gives row images, not intent.
- **Migrating existing activity/telemetry silos** (`post_activity`, `ticket_activity`, `sla_events`,
  `pipeline_log`, `assistant_events`, `status_component_events`, `workflow_run_events`) to async
  projections. Prospective rule only: **no new silos.** Only `audit_log` gets its _durability_ fixed
  (fed from `emit()` in-tx) — the table stays.
- **A unified subscriptions table** across sinks. Unify the router interface; keep sink-owned storage.
- **Merging the workflow and webhook runtimes.** Share the backbone, not the engines. Workflows
  become the best _consumer_, not the substrate.
- **External synchronous before-hooks / validating webhooks, ever.** Use pend-and-settle over
  ordinary async reactions instead. Removed from the roadmap.
- **Implicit historical replay into external sinks.** Replay is for projections/debugging and
  admin-initiated per-subscription backfill only (dry-run count first).
- **Auto-CRUD emission via a persistence base class.** Drizzle has no change tracking; auto-CRUD
  produces semantically-poor row-diffs nobody consumes. Emission is explicit + catalogue-verified.
- **Multi-workspace fan-out machinery.** Single workspace per instance (cloud tenants each run their
  own instance). Global sequence is a `bigint identity`; relay is a single advisory-lock leader.

---

## 2. Architecture & Normative Contracts

These interfaces are **frozen first** (WO-0/WO-1/WO-2) so parallel agents build against stable shapes.
Any change here requires re-syncing every dependent WO.

### 2.1 The envelope

```ts
// apps/web/src/lib/server/events/envelope.ts  (NEW — WO-1)
export type EventActorType = 'user' | 'anonymous' | 'service' | 'system'

export interface EventContext {
  correlationId?: string // request/trace id; propagated across caused events
  causationId?: string // event_id of the event that caused this one (loop tracing)
  depth: number // 0 for user-originated; +1 per reaction-caused mutation
  source?: string // 'api' | 'admin' | 'widget' | 'scheduler' | 'workflow' | 'import' ...
}

/** The canonical in-memory event, hydrated from an `events` row. */
export interface DomainEvent<P = unknown> {
  eventId: EvtId // TypeID 'evt_...'
  seq: bigint // global monotonic (events.id)
  type: string // catalogue key, e.g. 'post.status_changed'
  entityType: string // 'post'
  entityId: string // branded TypeID of the subject
  actorType: EventActorType
  actorId?: string
  payload: P // validated against catalogue zod schema
  context: EventContext
  schemaVersion: number
  occurredAt: Date
}
```

### 2.2 Catalogue: `defineEvent`

```ts
// apps/web/src/lib/server/events/catalogue/define.ts  (NEW — WO-2)
import type { z } from 'zod'

export interface EventExposure {
  webhook: boolean // appears in app/webhook pickers + OpenAPI webhook schemas
  workflow: boolean // becomes a workflow trigger
  notification: string | null // key into the notification matrix (null = not a notification)
  activity: string | null // documents the paired silo (post_activity, ...); does NOT automate
  audit: boolean // also write an audit_log row in the same tx
}

export interface EventDefinition<P> {
  type: string // '<entity>.<verb>'
  entity: string
  version: number
  payload: z.ZodType<P>
  exposure: EventExposure
  requiredScope: string // shared scope vocabulary; gates app subscriptions
  emits: 'always' | 'never' // 'never' = intentionally silent (votes, reactions); CI-visible
}

export function defineEvent<P>(
  type: string,
  def: Omit<EventDefinition<P>, 'type'>
): EventDefinition<P>

/** Registry lookups (built from all catalogue/*.ts at import time). */
export function getEventDefinition(type: string): EventDefinition<unknown> | undefined
export function allEventDefinitions(): ReadonlyArray<EventDefinition<unknown>>
```

Verb vocabulary (fixed): generic `created | updated | deleted | archived | restored`, plus semantic
verbs (`published`, `status_changed`, `merged`, `unmerged`, `assigned`, `priority_changed`,
`role_changed`, `member_added`, `member_removed`, ...). `updated` MAY carry
`changes: Record<field, {from, to}>` when the catalogue entry declares it; hot-path entities are
declared `emits: 'never'`.

Example declarations:

```ts
// catalogue/post.ts
export const postStatusChanged = defineEvent('post.status_changed', {
  entity: 'post',
  version: 1,
  payload: z.object({
    postId: typeIdSchema('post'),
    boardId: typeIdSchema('board'),
    from: typeIdSchema('post_status'),
    to: typeIdSchema('post_status'),
    title: z.string(),
  }),
  exposure: {
    webhook: true,
    workflow: true,
    notification: 'status_change',
    activity: 'post_activity',
    audit: false,
  },
  requiredScope: 'posts:read',
  emits: 'always',
})

// catalogue/apikey.ts
export const apiKeyCreated = defineEvent('apikey.created', {
  entity: 'apikey',
  version: 1,
  payload: z.object({
    apiKeyId: typeIdSchema('api_key'),
    name: z.string(),
    scopes: z.array(z.string()),
  }),
  exposure: { webhook: false, workflow: false, notification: null, activity: null, audit: true },
  requiredScope: 'admin:read',
  emits: 'always',
})

// catalogue/vote.ts — intentionally silent, documented so CI passes
export const voteCreated = defineEvent('vote.created', {
  entity: 'vote',
  version: 1,
  payload: z.object({ postId: typeIdSchema('post'), voterId: z.string() }),
  exposure: { webhook: false, workflow: false, notification: null, activity: null, audit: false },
  requiredScope: 'posts:read',
  emits: 'never',
})
```

### 2.3 Emission: `emit`

```ts
// apps/web/src/lib/server/events/emit.ts  (NEW — WO-1)
import type { PgTransaction } from 'drizzle-orm/pg-core'

export interface EmitInput<P> {
  payload: P
  actor: { type: EventActorType; id?: string }
  entityId: string
  context?: Partial<EventContext> // inherit() bumps depth/causation from a triggering event
  dedupeKey?: string | null // scheduler/retry idempotency
}

/**
 * Validate payload against the catalogue, INSERT one `events` row on the caller's tx,
 * write an audit_log row in the same tx when exposure.audit is true, and fire the
 * commit-time doorbell (pg_notify 'outbox_wake'). Never enqueues BullMQ directly.
 */
export async function emit<P>(
  tx: PgTransaction<any, any, any>,
  def: EventDefinition<P>,
  input: EmitInput<P>
): Promise<EvtId>

/** Build child context from a triggering event: depth+1, causationId=parent.eventId. */
export function inherit(parent: DomainEvent, source?: string): Partial<EventContext>
```

### 2.4 Resolver registry (replaces `getHookTargets()`)

```ts
// apps/web/src/lib/server/events/resolvers/registry.ts  (NEW — WO-2)
import type { HookTarget } from '../hook-types' // REUSE existing type

export interface SinkResolver {
  sink: string // 'webhook' | 'notification' | 'integration' | 'workflow' | 'ai' | 'summary' | 'feedback_pipeline'
  interestedIn(type: string): boolean // cheap; usually catalogue-derived
  resolve(event: DomainEvent): Promise<HookTarget[]> // sink-owned query over sink-owned storage
}

export function registerResolver(r: SinkResolver): void
export function resolveTargets(event: DomainEvent): Promise<HookTarget[]> // loops all resolvers
```

`HookTarget` (existing, `events/hook-types.ts`), `HookHandler` / `registerHook` / `getHook`
(existing, `events/registry.ts`), `hook_deliveries`, and `safeFetch` are **reused verbatim**.

### 2.5 Final DDL (authoritative — migration `0192`)

```sql
-- packages/db/drizzle/0192_events_outbox.sql
CREATE TABLE events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- global seq (single-workspace instance)
  event_id       text NOT NULL UNIQUE,          -- TypeID 'evt_...'
  type           text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      text NOT NULL,
  actor_type     text NOT NULL,                 -- 'user'|'anonymous'|'service'|'system'
  actor_id       text,
  payload        jsonb NOT NULL,
  context        jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version smallint NOT NULL DEFAULT 1,
  dedupe_key     text,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX events_unpublished_idx ON events (id) WHERE published_at IS NULL;  -- hot outbox path
CREATE INDEX events_entity_idx      ON events (entity_type, entity_id, id);      -- per-entity timeline/replay
CREATE INDEX events_type_idx        ON events (type, id);                        -- "did X fire?" / backfill
CREATE UNIQUE INDEX events_dedupe_idx ON events (dedupe_key) WHERE dedupe_key IS NOT NULL;
```

Relay leader lock: dedicated advisory-lock key (mirror `MIGRATION_LOCK_KEY = 4_820_231_099` in
`packages/db/src/migrate.ts`); pick `OUTBOX_RELAY_LOCK_KEY = 4_820_231_100`.

---

## 3. Phased Plan → Work Orders

Phases are independently shippable; Phase 0 changes zero external behavior. Effort tags: S (~1-2 days),
M (~3-5 days), L (~1-2 weeks).

### Phase 0 — Durable spine behind the existing API (retires: the commit-vs-enqueue loss window)

---

**WO-0 · Register `evt` TypeID prefix** · depends-on: none · effort: S

- Files: `packages/ids/src/prefixes.ts` (add `event: 'evt'`), `packages/ids/src/index.ts` (export
  `EvtId` type via existing branded-id machinery), `packages/ids/src/__tests__/*`.
- Contract: `EvtId` branded type + `generateId('event')` yields `evt_<base32>`; `typeIdSchema('event')`
  and `typeIdColumn('event')` work.
- Impl notes: follow the exact pattern of neighboring prefixes (`post`, `board`). Do NOT invent a new
  id mechanism.
- Test plan (write-first): unit — `generateId('event')` matches `^evt_[0-9a-z]{26}$`; round-trips
  through `typeIdColumn('event')` (uuid storage) and `typeIdSchema('event')` rejects wrong prefixes.
- Acceptance: `bun run test` green for ids package; `bun run typecheck` clean.
- Gotchas: the WO name must land before any schema/emit WO imports `EvtId`. This is a hard root dep.

---

**WO-1 · `events` outbox table + envelope + `emit()`** · depends-on: WO-0 · effort: M

- Files (create): `packages/db/drizzle/0192_events_outbox.sql`,
  `packages/db/src/__tests__/migration-0192-events-outbox.test.ts`,
  `packages/db/src/schema/events.ts`, add export to `packages/db/src/schema/index.ts`,
  `apps/web/src/lib/server/events/envelope.ts`, `apps/web/src/lib/server/events/emit.ts`,
  `apps/web/src/lib/server/events/__tests__/emit.test.ts`.
- Files (modify): `packages/db/drizzle/meta/_journal.json` (append idx 192, tag
  `0192_events_outbox`, version `"7"`, `breakpoints: true`).
- Contract: the DDL in §2.5 exactly; `DomainEvent`, `EventContext`, `EventActorType` (§2.1);
  `emit()` + `inherit()` (§2.3).
- Impl notes: `emit()` INSERTs on the passed `tx`, sets `event_id = generateId('event')`, validates
  `payload` via the catalogue def's zod schema (import `getEventDefinition`), and issues
  `SELECT pg_notify('outbox_wake', '')` on the same tx (Postgres delivers only on commit). When
  `exposure.audit`, also write the `audit_log` row here (this fixes audit's best-effort loss window).
  Do NOT enqueue BullMQ. `context.depth` defaults to 0.
- Test plan (write-first):
  - migration test: apply `0192`, assert columns/indexes/partial-index predicates exist (mirror
    `packages/db/src/__tests__/schema-audit-log.test.ts` shape).
  - `emit` unit/integration: inserts exactly one row with correct fields; rolls back with the tx
    (no orphan event on tx abort); rejects payloads that fail the zod schema; writes audit_log row
    iff `exposure.audit`; `pg_notify` issued.
- Acceptance: migration applies cleanly on a fresh DB; `emit` tests green; no BullMQ import in
  `emit.ts`.
- Gotchas: SQL-first — hand-write the SQL, NEVER run `bun run db:generate` (permanently broken). New
  migration index starts at **0192** (0191 is the uncommitted `notification_pref_matrix`). Match the
  `_journal.json` field order of existing entries exactly.

---

**WO-2 · Catalogue skeleton + `defineEvent` + resolver registry + coverage CI** · depends-on: WO-0,
WO-1 · effort: M

- Files (create): `events/catalogue/define.ts`, `events/catalogue/index.ts`,
  `events/catalogue/*.ts` (one file per emitting entity family — start with the existing 8 families'
  ~41 types), `events/resolvers/registry.ts`,
  `events/__tests__/catalogue-coverage.test.ts`, `events/__tests__/resolver-registry.test.ts`.
- Contract: `defineEvent` / `EventDefinition` / `EventExposure` (§2.2); `SinkResolver` /
  `registerResolver` / `resolveTargets` (§2.4).
- Impl notes: retro-declare all 41 current `EVENT_TYPES` (`events/types.ts`) as catalogue entries
  with best-effort zod payloads derived from existing `EventData` shapes. `resolveTargets` loops
  registered resolvers, concatenates `HookTarget[]`. Registry is import-time populated.
- Test plan (write-first):
  - **coverage test (the enforcement centerpiece):** every entity family present in
    `packages/db/src/schema` has ≥1 catalogue entry OR is on an explicit `SILENT_ENTITIES` allowlist;
    every `emits:'always'` def will (in later phases) have a call site — for now assert every current
    `EVENT_TYPES` member has a catalogue entry and vice versa (bijection with the legacy list).
  - registry: registering two resolvers, both `interestedIn`, concatenates targets; `interestedIn`
    false skips.
- Acceptance: catalogue is bijective with `EVENT_TYPES`; coverage test fails loudly if a type is
  added to one and not the other.
- Gotchas: do NOT wire resolvers to real sinks yet (Phase 2). This WO only stands up the abstraction
  - the CI gate so later parallel work has a stable target.

---

**WO-3 · Relay worker + doorbell + deterministic jobIds** · depends-on: WO-1, WO-2 · effort: M

- Files (create): `events/relay.ts`, `events/relay-lock.ts`,
  `events/__tests__/relay.test.ts`; register startup in `apps/web/src/lib/server/startup.ts` (or the
  existing worker-bootstrap module).
- Files (modify): `events/process.ts` (the enqueue path — accept deterministic jobId).
- Contract: relay drains `SELECT ... WHERE published_at IS NULL ORDER BY id LIMIT 100`, calls
  `resolveTargets(event)`, enqueues one `{event-hooks}` job per target with
  `jobId = ${eventId}:${sink}:${targetKey}`, then `UPDATE events SET published_at = now()`.
- Impl notes:
  - **Worker-role only.** Guard startup with `shouldRunWorkers()` (`lib/server/queue/role.ts`). Web
    replicas emit to the outbox but MUST NOT run the relay.
  - **Leader election:** `pg_try_advisory_lock(OUTBOX_RELAY_LOCK_KEY)` on a dedicated connection;
    only the holder drains (mirror `migrate.ts` advisory-lock usage). Non-leaders idle.
  - **Doorbell:** `LISTEN outbox_wake` on a dedicated pg connection to wake immediately; fall back to
    a 1s poll for the crash/missed-notify case.
  - **Depth guard:** refuse to route events with `context.depth > 5`; log loudly + mark published
    (they are not lost, just not fanned out) to avoid reaction loops.
  - Reuse the existing `{event-hooks}` queue (Dragonfly hashtag-pinned names) and its
    `attempts: 3 / removeOnComplete` opts (`events/process.ts`).
- Test plan (write-first): integration — insert 3 unpublished events, run one drain tick, assert 3×N
  jobs enqueued with deterministic ids + all rows now `published_at NOT NULL`; re-running the tick
  enqueues nothing new (idempotent publish via deterministic jobId + BullMQ dedupe); a `depth:6` event
  is skipped and marked published; two relay instances → only the lock holder drains.
- Acceptance: at-least-once end-to-end; deterministic jobIds; leader-only; worker-role-only.
- Gotchas: deterministic jobId is load-bearing for effectively-once (feeds `hook_deliveries`). BullMQ
  `removeOnComplete` prunes completed jobs — the `hook_deliveries` row (not the job) is the durable
  idempotency record; don't rely on job existence.

---

**WO-4 · Route legacy `dispatchEvent()` internals through the outbox (shim, no call-site change)** ·
depends-on: WO-1, WO-2, WO-3 · effort: M

- Files (modify): `events/dispatch.ts`, `events/process.ts`, `events/index.ts`.
- Contract: existing `dispatch*()` public signatures unchanged. Internally, each maps to a catalogue
  def and calls `emit(tx, def, ...)` when a tx is in scope; a transitional `dispatchEventTx(tx, ...)`
  is added for callers that already hold a tx.
- Impl notes: this is the "zero call-site change, closes the loss window" step. For dispatchers whose
  callers do NOT currently pass a tx, provide an interim path that opens a short tx solely to write the
  outbox row (still strictly better than fire-and-forget-after-commit; Phase 1 moves them into the
  caller's tx). The old direct `{event-hooks}` enqueue from `processEvent()` is removed — the relay is
  now the sole enqueuer.
- Test plan (write-first): for each of the 8 emitting families, calling the legacy `dispatch*()`
  writes exactly one `events` row and (after a relay tick) the same targets that
  `getHookTargets()` would have produced — assert via a golden-target snapshot captured from the old
  path (this snapshot is reused by the Phase 5 shadow-diff).
- Acceptance: all existing event-hook integration tests pass unchanged; no code path enqueues
  `{event-hooks}` except the relay.
- Gotchas: capture the golden target snapshots BEFORE deleting anything — Phase 5's parallel-run
  verification depends on them.

---

### Phase 1 — Coverage (retires: coverage-by-memory; audit_log loss window; the 5-file edit)

---

**WO-5 · Catalogue payload schemas hardened + `updated`-diff policy** · depends-on: WO-2 · effort: S

- Files: `events/catalogue/*.ts`, `events/__tests__/catalogue-payloads.test.ts`.
- Impl notes: replace best-effort payloads from WO-2 with precise zod schemas; decide per entity
  whether `updated` carries `changes`. Add `schemaVersion` discipline doc-comment (additive-only
  within a version; new version for breaking changes).
- Test plan: every payload schema parses a representative fixture; snapshot the JSON shape.
- Acceptance/gotchas: PII review — sanitize actor/author emails via `realEmail()`
  (`lib/shared/anonymous-email.ts`); payloads outlive the request in a 90-day log.

---

**WO-6a/6b/6c · Explicit emission for high-demand silent families** · depends-on: WO-4, WO-5 ·
effort: M each (three parallel WOs)

Split the silent families into three independent PRs so agents don't collide:

- **WO-6a (identity/admin):** principals/members, RBAC roles, api-keys, settings, teams. Events:
  `member.added|removed|role_changed`, `apikey.created|deleted`, `settings.updated`,
  `team.created|updated|deleted`. Most are `exposure.audit: true`.
- **WO-6b (content/taxonomy):** boards, tags, categories, KB articles, roadmap, saved views. Events:
  `board.created|updated|archived`, `tag.created|deleted`, `article.published|updated`,
  `roadmap.updated`, etc.
- **WO-6c (CRM/ops):** companies, segments, macros, channel-accounts, import-runs, merge-suggestions,
  moderation/flags. Events per catalogue.
- Files: the respective `domains/*/**.service.ts` (add `emit(tx, ...)` inside existing write txs) +
  `events/catalogue/*.ts` + per-family emission tests.
- Impl notes: emit INSIDE the caller's existing transaction. Declare intentionally-silent entities
  (votes, reactions, view counters) as `emits:'never'` in the catalogue so the coverage test passes
  without spamming.
- Test plan (write-first): each service write emits exactly one row with correct payload/actor;
  `emits:'never'` families assert NO row.
- Acceptance: `catalogue-coverage.test.ts` now enforces "every schema entity family is declared
  emitting or explicitly silent"; CI red if a new table lands without a decision.
- Gotchas: keep hot paths (votes) silent — auto-emit spam is an explicit non-goal.

---

**WO-7 · audit_log fed from `emit()` (durability fix)** · depends-on: WO-1 · effort: S

- Files: `events/emit.ts` (already wired in WO-1), `domains/**/audit call sites`, migration-free.
- Impl notes: migrate current best-effort out-of-tx audit writes to rely on
  `exposure.audit: true` catalogue entries (written in-tx by `emit`). Remove the old global-connection
  best-effort audit path once parity is proven.
- Test plan: audit row is written in the same tx as the mutation (rolls back together); no audit rows
  on aborted tx.
- Acceptance: audit_log no longer has a loss window; existing audit tests pass.
- Gotchas: don't drop the dedicated `audit_log` table — compliance wants a purpose-built queryable
  table, not a filter over `events`.

---

### Phase 2 — Resolver registry (retires: the monolith; adding a sink = registration)

---

**WO-8a..8e · Extract `getHookTargets()` builders into resolvers** · depends-on: WO-2, WO-4 · effort:
S-M each (five parallel WOs)

Decompose the 1251-line if-ladder into one `SinkResolver` per existing bespoke builder,
behavior-preserving:

- **WO-8a webhookResolver** — reads customer webhook subscriptions.
- **WO-8b integrationResolver** — reads `integration_event_mappings` (existing table).
- **WO-8c notificationResolver** — fans out per-user via `post_subscriptions` /
  `changelog_subscriptions` / `status_subscriptions` × mention detection × the notification `matrix`
  (`subscriptions/notification-matrix.ts`) × channel.
- **WO-8d aiResolver + summaryResolver + feedbackPipelineResolver** — the system-internal always-on
  sinks (fixed type lists).
- **WO-8e workflowTriggerResolver** — replaces the special-cased durable trigger path; the outbox is
  now the durability so `workflow-dispatch-queue.ts`'s bespoke durability is redundant (deletion in
  Phase 5).
- Files: `events/resolvers/*.ts`, register each in `resolvers/registry.ts`, per-resolver tests.
- Impl notes: each resolver's `interestedIn` is derived from `exposure.*` in the catalogue; each
  `resolve` moves the corresponding block out of `targets.ts` verbatim (queries unchanged).
- Test plan (write-first): golden-target parity — for a battery of events, `resolveTargets(event)`
  equals the captured `getHookTargets()` snapshot from WO-4 (set-equality on `{type,target,config}`).
- Acceptance: `resolveTargets` reproduces the monolith's output for every event type; the relay
  (WO-3) already calls `resolveTargets`, so wiring is a swap.
- Gotchas: notification resolver is the tricky one (per-user, matrix, mentions) — port, don't
  redesign. Constant arrays (`SUBSCRIBER_EVENT_TYPES` etc.) become catalogue-derived; keep old arrays
  alive until Phase 5 deletes them.

---

### Phase 3 — Catalogue feeds surfaces (retires: webhook/workflow/notification drift; parallel trigger

map)

---

**WO-9 · Generate webhook event picker + OpenAPI webhook schemas from the catalogue** · depends-on:
WO-2, WO-8a · effort: M

- Files: webhook admin UI event list source, OpenAPI generator (`routes/api/v1/` webhook docs), tests.
- Impl notes: the picker + OpenAPI `webhooks` section enumerate all `exposure.webhook: true` defs. No
  more "advertises 4, supports 30."
- Test plan: generated webhook event list === catalogue `webhook:true` set.

---

**WO-10 · Widen workflow triggers to all `workflow:true` events + add `send_webhook` action + depth
guard** · depends-on: WO-8e · effort: M

- Files: `domains/workflows/event-trigger.ts`, `dispatcher.ts`, add a `send_webhook` action node
  (through `safeFetch`), tests.
- Impl notes: post/comment/changelog triggers currently map to null — now map to catalogue events.
  `send_webhook` sits alongside the existing `call_connector` escape. Workflow-caused mutations emit
  with `inherit(parentEvent)` (depth+1). Relay depth guard (WO-3) enforces the ceiling.
- Test plan: a `post.status_changed` trigger fires a workflow; a workflow that mutates a post emits a
  depth-incremented event; a 6-deep chain is halted by the relay guard.
- Gotchas: loop protection is a launch requirement, not optional hardening.

---

**WO-11 · Notification matrix keys = catalogue keys** · depends-on: WO-8c, and the in-flight
`0191_notification_pref_matrix` work · effort: S

- Files: `subscriptions/notification-matrix.ts`, `notification-type-config.ts`,
  `components/notifications/*`.
- Impl notes: notification _types_ become a projection of catalogue `exposure.notification` keys;
  string-keyed matrix already needs no migration per new type. Lands on the uncommitted matrix branch.
- Test plan: every `exposure.notification` value has a matrix key; `shouldNotify` resolves it.

---

### Phase 4 — OAuth app platform (retires: hardcoded registry as sole extension point)

---

**WO-12 · `apps` table + migration** · depends-on: WO-0 · effort: M

- Files: `packages/db/drizzle/0193_apps.sql` (+ `_journal.json` idx 193),
  `packages/db/src/__tests__/migration-0193-apps.test.ts`, `packages/db/src/schema/apps.ts`.
- DDL contract:

```sql
CREATE TABLE apps (
  id                    text PRIMARY KEY,               -- TypeID (register 'app' prefix in this WO)
  oauth_client_id       text NOT NULL,                  -- FK to better-auth oauth client
  name                  text NOT NULL,
  granted_scopes        text[] NOT NULL DEFAULT '{}',
  webhook_endpoint      text,
  webhook_secret_enc    text,                           -- encrypted at rest (reuse integrations/encryption.ts)
  subscribed_event_types text[] NOT NULL DEFAULT '{}',
  status                text NOT NULL DEFAULT 'active',  -- 'active'|'disabled'
  created_at            timestamptz NOT NULL DEFAULT now()
);
```

- Gotchas: register `app` prefix in `@quackback/ids` here (same pattern as WO-0). Reuse
  `integrations/encryption.ts` for the webhook secret; never store plaintext.

---

**WO-13 · App webhook resolver (scope-gated) + signed delivery** · depends-on: WO-12, WO-8a · effort:
M

- Files: `events/resolvers/app-webhook.resolver.ts`, a signed-delivery HookHandler variant (HMAC,
  timestamped signature + replay window) reusing `safeFetch`, tests.
- Impl notes: the app-webhook resolver reads `apps` alongside legacy webhooks; a subscription to an
  event is honored only if the app's `granted_scopes` include the catalogue def's `requiredScope`.
  Delivery goes through the existing webhook HookHandler + `hook_deliveries` + `safeFetch`.
- Test plan: app subscribed with insufficient scope → no target; sufficient scope → signed delivery;
  signature verifies; replayed timestamp rejected.
- Gotchas: scope check reuses the shared scope vocabulary (`api-key-scopes.ts`); do not invent a new
  authz axis.

---

**WO-14 · App management UI + admin-initiated per-subscription backfill (dry-run first)** ·
depends-on: WO-13 · effort: M

- Impl notes: backfill reads `events WHERE type = ANY(subscribed) AND id > cursor`, shows a dry-run
  count, then replays into that one subscription only. NEVER implicit; NEVER fans historical events to
  all sinks.

---

## 4. Phase 5 — Cutover & Removal (retires: the entire legacy path)

Goal: every existing consumer runs on the new spine, then the old code is **deleted** with CI gates
that prevent it from ever coming back.

### 5.1 Parallel-run / shadow verification (do this BEFORE any deletion)

**WO-15 · Shadow-diff harness** · depends-on: WO-4, WO-8a..8e · effort: M

- Files: `events/__tests__/shadow-diff.test.ts`, a temporary `resolveTargetsLegacy()` retained wrapper
  around the old `getHookTargets()`.
- Impl notes: for a corpus of synthetic events spanning ALL catalogue types, assert
  set-equality between `resolveTargets(event)` (new) and `getHookTargets(...)` (legacy). Run it in CI
  AND (behind the cutover flag, dry-run) in a staging env that logs any divergence without delivering.
- Acceptance: zero divergence across all event types for a full soak window before flip.
- Gotchas: this harness is the safety net for the deletions in §5.4. Keep `getHookTargets()` alive
  ONLY until WO-15 is green in soak.

### 5.2 Feature flag gate

**WO-16 · `eventingV2` cutover flag** · depends-on: WO-3 · effort: S

- Files: `domains/settings/settings.types.ts` (`FeatureFlags` + `DEFAULT_FEATURE_FLAGS`),
  `settings.service.ts` (`isFeatureEnabled`), relay + dispatch shim read it.
- Impl notes: DB-backed flag (default OFF initially). When OFF: relay disabled, legacy direct-enqueue
  path active. When ON: relay is sole enqueuer. This gates rollout AND rollback (§6). Flip default ON
  only after soak.
- Test plan: flag OFF → legacy path enqueues; flag ON → relay enqueues, legacy path inert.

### 5.3 Per-integration + per-hook migration checklist

All 25 first-party integrations (the exact `registry` Map in
`apps/web/src/lib/server/integrations/index.ts`) already flow through `integration_event_mappings` +
`HookHandler` + the (soon-legacy) `integrationResolver` block. Cutover = confirm each provider's
targets are produced by `integrationResolver` (WO-8b) with shadow-diff parity, then tick it off.
No provider needs code changes unless shadow-diff diverges. Capability columns below are
authoritative (verified against each `IntegrationDefinition`): **hook** = outbound push,
**inbound** = bidirectional status-sync webhook handler, **context** = read-only CRM enrichment
(no outbound hook), **userSync** = CDP identify + segment membership, **feedbackSource** = inbound
message ingestion.

**WO-17 · Integration cutover checklist** · depends-on: WO-8b, WO-15 · effort: M

| #   | Provider (dir) | Category       | oauth | hook | inbound | other                                        | Shadow-diff | Migrated |
| --- | -------------- | -------------- | ----- | ---- | ------- | -------------------------------------------- | ----------- | -------- |
| 1   | slack          | notifications  | ✓     | ✓    | —       | feedbackSource (events + interactivity)      | ☐           | ☐        |
| 2   | discord        | notifications  | ✓     | ✓    | —       | notification-only                            | ☐           | ☐        |
| 3   | teams          | notifications  | ✓     | ✓    | —       | notification-only                            | ☐           | ☐        |
| 4   | ntfy           | notifications  | —     | ✓    | —       | url push, no platform creds                  | ☐           | ☐        |
| 5   | linear         | issue_tracking | ✓     | ✓    | ✓       | webhook auto-register                        | ☐           | ☐        |
| 6   | github         | issue_tracking | ✓     | ✓    | ✓       | webhook auto-register                        | ☐           | ☐        |
| 7   | jira           | issue_tracking | ✓     | ✓    | ✓       | webhook auto-register                        | ☐           | ☐        |
| 8   | gitlab         | issue_tracking | ✓     | ✓    | ✓       |                                              | ☐           | ☐        |
| 9   | asana          | issue_tracking | ✓     | ✓    | ✓       | webhook auto-register                        | ☐           | ☐        |
| 10  | clickup        | issue_tracking | ✓     | ✓    | ✓       | webhook auto-register                        | ☐           | ☐        |
| 11  | trello         | issue_tracking | ✓     | ✓    | ✓       |                                              | ☐           | ☐        |
| 12  | monday         | issue_tracking | ✓     | ✓    | —       | outbound only                                | ☐           | ☐        |
| 13  | notion         | issue_tracking | ✓     | ✓    | —       | outbound only                                | ☐           | ☐        |
| 14  | shortcut       | issue_tracking | —     | ✓    | ✓       | token auth, no platform creds                | ☐           | ☐        |
| 15  | azure-devops   | issue_tracking | —     | ✓    | ✓       | PAT auth, manual webhook                     | ☐           | ☐        |
| 16  | zendesk        | support_crm    | ✓     | —    | —       | context enrich + sidebar app                 | ☐           | ☐        |
| 17  | intercom       | support_crm    | ✓     | —    | —       | context enrich                               | ☐           | ☐        |
| 18  | hubspot        | support_crm    | ✓     | —    | —       | context enrich                               | ☐           | ☐        |
| 19  | salesforce     | support_crm    | ✓     | ✓    | —       | push + oauth                                 | ☐           | ☐        |
| 20  | stripe         | support_crm    | —     | ✓    | —       | webhook-driven                               | ☐           | ☐        |
| 21  | freshdesk      | support_crm    | —     | ✓    | —       | outbound push                                | ☐           | ☐        |
| 22  | segment        | user_data      | —     | —    | —       | userSync (CDP identify + segment membership) | ☐           | ☐        |
| 23  | zapier         | automation     | —     | ✓    | —       | generic webhook push                         | ☐           | ☐        |
| 24  | make           | automation     | —     | ✓    | —       | generic webhook push                         | ☐           | ☐        |
| 25  | n8n            | automation     | —     | ✓    | —       | generic webhook push                         | ☐           | ☐        |

Note: `context`-only providers (zendesk, intercom, hubspot) register **no** `hook`, so they produce
no event targets — their cutover is a no-op verification (confirm the resolver yields zero targets
for them, same as today). `segment` has no `hook` either; its userSync path is orthogonal to the
event bus and is **out of scope for the resolver cutover** (tracked separately in Phase 4's app model).

**Built-in hooks & paths checklist** (same WO):

| Consumer               | Source                       | Cutover action                                    | Done |
| ---------------------- | ---------------------------- | ------------------------------------------------- | ---- |
| email hook             | `events/registry.ts` builtin | via notificationResolver/webhookResolver targets  | ☐    |
| notification hook      | builtin                      | via notificationResolver (WO-8c)                  | ☐    |
| ai hook                | builtin                      | via aiResolver (WO-8d)                            | ☐    |
| webhook hook           | builtin                      | via webhookResolver (WO-8a) + app-webhook (WO-13) | ☐    |
| summary hook           | lazy                         | via summaryResolver (WO-8d)                       | ☐    |
| feedback_pipeline hook | lazy                         | via feedbackPipelineResolver (WO-8d)              | ☐    |
| customer webhooks      | webhooks table               | via webhookResolver (WO-8a)                       | ☐    |
| workflow triggers      | `workflow-dispatch-queue.ts` | via workflowTriggerResolver (WO-8e)               | ☐    |

### 5.4 Deletions (only after §5.1 soak is green and flag default is ON)

**WO-18 · Delete legacy fire-and-forget + monolith** · depends-on: WO-15, WO-16, WO-17 · effort: M

- Delete: the direct-enqueue fire-and-forget path in `events/process.ts`/`dispatch.ts`; the entire
  `getHookTargets()` if-ladder + constant arrays (`SUBSCRIBER_EVENT_TYPES`, `MENTION_EVENT_TYPES`,
  `AI_EVENT_TYPES`, `SUMMARY_EVENT_TYPES`) in `events/targets.ts`; `resolveTargetsLegacy` shim;
  the special-cased durable workflow-trigger queue (`domains/workflows/workflow-dispatch-queue.ts`)
  now that the outbox provides durability; any now-dead `dispatchEventTx`-vs-legacy branches.
- Safety checks: WO-15 shadow-diff must have zero divergence in soak; `bun run test` + `typecheck` +
  `lint` green; the enforcement gate (WO-19) added first.
- Gotchas: delete `targets.ts` contents but keep any pure helper types still imported by resolvers
  (move them, don't duplicate).

**WO-19 · "No old path remains" CI enforcement** · depends-on: WO-18 · effort: S

- Files: a lint rule + a grep-based CI check (`scripts/` or an eslint custom rule).
- Rules that FAIL CI:
  - any BullMQ `.add(` onto the `{event-hooks}` queue outside `events/relay.ts`.
  - any import/use of the deleted `getHookTargets` / `dispatchEvent` legacy fire-and-forget symbols.
  - any new event type in `EVENT_TYPES`-style arrays without a corresponding `defineEvent` (the
    coverage test from WO-2 already covers this; make it a required check).
  - any new activity/telemetry silo table without a paired catalogue `activity:` declaration (soft
    warn).
- Acceptance: reintroducing the old path turns CI red.

### 5.5 Retention

**WO-20 · Events retention compactor** · depends-on: WO-1 · effort: S

- Files: `events/events-sweep.ts` + queue registration mirroring
  `domains/workflows/workflow-sweep-queue.ts` / `workflow-sweep.ts`.
- Impl notes: worker-role sweeper deletes `events WHERE published_at IS NOT NULL AND published_at <
now() - retention` (default 90 days, configurable). Never deletes unpublished rows.
- Test plan: old published rows pruned; unpublished + recent rows retained.

---

## 5. Parallelization Guide

### 5.1 Frozen-first contracts (must land before parallel fan-out)

1. **WO-0** (`evt` TypeID) — hard root; everything schema/emit depends on it.
2. **WO-1** (`events` table + envelope + `emit`) — freezes DDL (§2.5) + `DomainEvent`/`emit` (§2.1/2.3).
3. **WO-2** (`defineEvent` + `SinkResolver` + coverage CI) — freezes catalogue + resolver interfaces
   (§2.2/2.4).

Once WO-0/1/2 are merged, the interfaces in §2 are stable and the rest fans out.

### 5.2 Dependency graph

```
WO-0 ──┬─> WO-1 ──┬─> WO-2 ──┬─> WO-8a ─┐
       │          │          ├─> WO-8b ─┤
       │          │          ├─> WO-8c ─┼─> WO-9 / WO-10 / WO-11   (Phase 3, parallel)
       │          │          ├─> WO-8d ─┤        │
       │          │          └─> WO-8e ─┘        │
       │          ├─> WO-3 ──> WO-4 ──> WO-5 ──> WO-6a/6b/6c (parallel)
       │          │                     └─> WO-7
       │          └─> WO-20 (retention)
       └─> WO-12 ──> WO-13 ──> WO-14                (Phase 4, parallel with Phase 2/3)
WO-15 (shadow) depends on WO-4 + WO-8a..8e
WO-16 (flag)  depends on WO-3
WO-17 (checklist) depends on WO-8b + WO-15
WO-18 (delete) depends on WO-15 + WO-16 + WO-17
WO-19 (CI gate) depends on WO-18
```

### 5.3 Concurrency table

| Can run concurrently              | Must serialize before                                |
| --------------------------------- | ---------------------------------------------------- |
| WO-6a, WO-6b, WO-6c               | after WO-4 + WO-5                                    |
| WO-8a, WO-8b, WO-8c, WO-8d, WO-8e | after WO-2; each independent (own resolver file)     |
| WO-9, WO-10, WO-11                | after their respective WO-8x                         |
| WO-12→13→14 (Phase 4 chain)       | independent of Phase 2/3; can start right after WO-0 |
| WO-7, WO-20                       | after WO-1                                           |
| WO-15, WO-16                      | after WO-3 (WO-15 also needs WO-8x)                  |
| WO-17, WO-18, WO-19               | strictly serial at the end                           |

Rule for parallel agents: never edit `events/targets.ts` from two WOs at once — the WO-8x extractions
each remove their own block; coordinate by having WO-8x agents ADD new resolver files and only
DELETE their own block, leaving the ladder shrinking monotonically until WO-18 removes the remainder.

---

## 6. Rollout, Rollback, Feature-Flagging, Observability

### 6.1 Feature flag

- `FeatureFlags.eventingV2` (DB-backed, `settings.service.ts` / `settings.types.ts`;
  default read via read-time spread so it defaults OFF without a migration — mirror
  `resolveFeatureFlags`). OFF = legacy enqueue path; ON = relay is sole enqueuer.
- **Rollout:** ship Phases 0-2 with flag OFF (outbox writes happen but relay dormant → belt-and-braces
  with legacy path still delivering). Enable in staging, run WO-15 shadow-diff soak, then flip ON in
  prod. Default ON only after a clean soak window across all event types.
- **Rollback:** flip `eventingV2` OFF → relay stops, legacy path resumes. Because outbox writes are
  in-tx and idempotent, no data loss on flip either direction. Rollback is instant and requires no
  deploy. (Note: after WO-18 deletes the legacy path, rollback is deploy-based — do not delete until
  soak is unambiguously green.)

### 6.2 Observability (the "did it fire?" surface)

- **Relay lag metric:** age of the oldest `events WHERE published_at IS NULL` (gauge) + count of
  unpublished rows. Export via the existing pino/metrics surface; alert if lag > 60s. This gauge IS
  the "did it fire?" answer — an admin-visible "event delivery" panel reads it.
- **Per-event trace:** `context.correlationId` / `causationId` threaded through emitted events enables
  "show me everything this action caused," including reaction chains (bounded by depth guard).
- **Depth-guard counter:** number of events refused for depth > 5 — a nonzero value flags a reaction
  loop; alert.
- **Delivery outcomes** continue to come from `hook_deliveries` (processing-lease | completed |
  failed) unchanged.

### 6.3 Failure modes to watch

- **Relay is the new SPOF for latency** — leader lock + doorbell + 1s poll fallback; monitor lag.
- **Outbox growth** on chatty instances — WO-20 compactor from day one; partial index keeps the hot
  path immune to table size.
- **Duplicate storms** if anyone bypasses deterministic jobIds — WO-19 lint gate is load-bearing.
- **Reaction loops** once workflows both consume and cause events — depth counter is a launch
  requirement (WO-3 + WO-10).
- **PII in payloads** — snapshot minimalism + `realEmail()` sanitation + scope-gated app subscriptions;
  reviewed at catalogue-review time (WO-5).
- **Catalogue schema drift** — additive-only within a `schema_version`; new version for breaking
  changes; enforced in code review + the coverage test.

---

## Appendix A — Decision log (why these choices)

- **Outbox over CDC / LISTEN-NOTIFY-as-store / audit_log-as-log / direct-with-idempotency.** CDC hurts
  OSS adoptability and yields row images not intent; LISTEN/NOTIFY isn't durable (used only as the
  commit-time doorbell); `audit_log` is scoped + itself out-of-tx best-effort; direct-with-idempotency
  is the status quo bug. Outbox is the one new table that closes the loss window.
- **Explicit emission over BaseService auto-CRUD.** No BaseService exists; Drizzle has no change
  tracking. Auto-CRUD = build a new persistence layer to emit the least-valuable (row-diff) events.
  Catalogue + CI coverage test is the right enforcement.
- **Resolver registry unifies the router, not the storage.** The 4 sinks have genuinely different
  subscription semantics (matcher vs per-user query vs graph vs always-on); a unified `subscriptions`
  table leaks. Unify `getHookTargets()`; keep sink-owned storage.
- **Workflow engine is the best consumer, not the substrate.** It's user-authored/versioned/editable;
  routing system behavior through it means users can break invariants. Widen its triggers + add
  `send_webhook`, don't make it the bus.
- **No external before-hooks.** Sync veto = third-party availability dependency in the write path.
  Pend-and-settle over async reactions is strictly better and reuses existing post-moderation infra.
- **Single-workspace simplifications.** `bigint identity` global seq; one advisory-lock leader; no
  partitioning.

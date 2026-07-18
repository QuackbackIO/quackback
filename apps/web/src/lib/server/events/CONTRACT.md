# Event & sink contract

The rules every domain event and delivery sink follows. Enforced in CI by
`__tests__/catalogue-coverage.test.ts` and `__tests__/webhook-surface-catalogue.test.ts`;
this doc is the human-readable source. If you add an event or a sink, this is the
checklist.

## 1. Naming — `<entity>.<verb>`

- **entity** MUST be a `@quackback/ids` key (`ID_PREFIXES`) — e.g. `post`,
  `post_comment`, `api_key`, `kb_article`, `conversation_message`. Singletons
  with no TypeID (`settings`) live on the `VIRTUAL_ENTITIES` allowlist. This
  keeps the event's `entity` field usable as a real join key for per-entity
  timelines, backfill, and audit.
- **verb** MUST come from the fixed vocabulary (CI-checked):
  - generic lifecycle: `created` · `updated` · `deleted` · `restored` · `archived`
  - semantic (curated): `status_changed`, `assigned`, `priority_changed`,
    `merged`, `unmerged`, `mentioned`, `published`, `replied`, `handed_off`,
    `csat_submitted`, `breached`, `external_status_changed` (a linked tracker
    issue moved upstream), … (add new ones to the list _on purpose_).
- A new verb is a deliberate decision, not a drive-by string. Adding one and
  forgetting the list turns CI red.
- Legacy compound verbs (`status.incident_created`) are grandfathered; new
  status-page-shaped events should prefer `<entity>.<verb>`.

## 2. Envelope — frozen (`envelope.ts`)

`DomainEvent`: `eventId · seq · type · entityType · entityId · actorType ·
actorId · payload · context · schemaVersion · occurredAt`. Do not add fields
here without re-syncing every consumer — the whole system builds on this shape.
`actorType ∈ { user, anonymous, service, system }`.

## 3. Payload conventions

Not one shape — one set of rules:

- Always carry the subject **entity id**.
- Carry a **minimal snapshot** — only the fields the event is _about_ (enough to
  render a Slack line / an email subject), never the whole row. Consumers hydrate
  by id. Payloads outlive the request (~90-day log): keep PII minimal and run
  emails through `realEmail()` (drop synthetic anon placeholders).
- `updated` events carry `changedKeys: string[]` (the fields that changed). Use
  the full `changes: Record<field,{from,to}>` shape only when a consumer needs
  before/after — declare it per type, don't mix conventions.
- **Versioned.** Payload changes are additive within a `schema_version`; a
  breaking change bumps the version. Never repurpose a field.

## 4. Authorization — one spine, not a parallel one

An event declares a **`category: PermissionCategory`** — the SAME mid-tier
vocabulary permissions use. Its `requiredScope` is **derived** from that category
via `readScopeForCategory` (the same `CATEGORY_SCOPES` map `scopeForPermission`
uses). So:

```
permission key ──┐
event type ──────┼──> PermissionCategory ──> ApiKeyScope (read/write)
                 ┘         (15 values)            (7 values)
```

App/OAuth subscriptions are gated on the event's derived scope being within the
app's `granted_scopes` — the identical scope check the REST API and MCP already
run. **Never invent a new scope string on an event.** CI asserts `category ∈
PERMISSION_CATEGORIES` and `requiredScope ∈ API_KEY_SCOPES`.

## 5. Exposure — declared once (`defineEvent`)

`exposure: { webhook, workflow, notification, activity, audit }` drives every
downstream surface from one declaration:

- `webhook: true` → appears in the customer-webhook picker + OpenAPI (pinned by
  the surface gate so it can't drift).
- `workflow: true` → becomes a workflow trigger.
- `notification: <key> | null` → key into the notification matrix.
- `activity: <silo> | null` → documents the paired activity table (does not
  automate it — "no new silos").
- `audit: true` → `emit()` writes an `audit_log` row in the same transaction.
- `emits: 'always' | 'never'` → `'never'` = intentionally silent (votes,
  reactions, view counters), declared so the coverage gate passes without spam.

## 6. Emission

`emit(tx, def, …)` inside the mutation's transaction (atomic with the write), or
`emitBestEffort(def, …)` for services with no surrounding tx (opens a short one,
never throws). Never enqueue `{event-hooks}` directly — the relay is the sole
enqueuer (CI-enforced by the enqueue gate).

## 7. Sinks (a.k.a. "hooks") — one contract, one registration

Reactions to events are **sinks**, not "hooks". Each implements
`HookHandler.run(event, target, config, ctx)` and is resolved by a
`SinkResolver` in the registry. To disambiguate the overloaded word:

- **sink** = a delivery target (email / notification / webhook / app_webhook /
  integration / workflow / ai / summary).
- **connector** = a first-party integration's outbound `IntegrationDefinition.hook`.
- **inbound handler** = an external → Quackback webhook receiver.
- **auth hook** = better-auth `hooks.before/after` (the only in-request hooks).

**No external before-hooks — ever.** A third party in the write path couples your
availability + latency to theirs and hands them veto/mutate power. Internal
validation (tier limits, moderation, dedup) stays in the policy/service layer —
the service layer _is_ the before-hook. For external "veto", use **pend-and-settle**
(create in a `pending` state, an async reaction adjudicates, a settling event
transitions it) — reuses the post-moderation infra, no availability coupling.

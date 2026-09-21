# Integration sync safety

PR #575 replaces independent integration retries with a forward-only durable sync ledger. Sync history starts empty; old deliveries are discarded, not imported or retried. The ordinary event queue still serves webhooks, notifications and workflows; it no longer executes integration hooks. No deployment or live provider writes are part of the local validation.

## Review and implementation plan

Reviewed PR head: `f3aa1c264dc198bb00075d7749afcac9df940b26`, on `fix/integration-post-sync-retries`.

Both Codex findings were accurate:

- [P1: atomically claim deliveries](https://github.com/QuackbackIO/quackback/pull/575#discussion_r4058023885). Concurrent old queue jobs could all read an absent receipt before executing the same remote create. A queue dedupe key alone did not fence them.
- [P2: preserve failure health](https://github.com/QuackbackIO/quackback/pull/575#discussion_r4057960308). A successful refresh callback could clear a sibling's error. Health now derives from all unresolved operations for the current installation.

The review also found that a successful remote create followed by a failed local association could leave an orphan and later create again. A link for one destination could incorrectly suppress work for another. These require durable evidence and scoped associations, beyond the original two fixes.

The implementation follows these ordered slices:

1. Establish immutable operation identity, claims, dispatch markers, attempt history, fencing and recovery. Verify concurrent producers, crashes and commit failures against PostgreSQL.
2. Move post delivery and content review onto the ledger. Keep canonical rich content, visit every active link, and expose integration-page Sync history using existing components.
3. Move ticket creation, status changes and selected archive requests. Commit local links, notes, domain events and completion together.
4. Persist verified inbound status and identify work before acknowledgement; separate linked sources and enforce ordering and destination identity.
5. Move existing dynamic-segment membership delivery and the Slack app-hook queue. Resolve current credentials and source eligibility at execution.
6. Remove legacy writers and import/compatibility paths. Record the start boundary, discard retired jobs, verify migrations, run regressions and review desktop/mobile UI.

## Follow-up review and simplification

The review of `7c8971fec` confirmed both new Codex comments:

- [Restored creates](https://github.com/QuackbackIO/quackback/pull/575#discussion_r4061210775): a source-driven cancellation could strand a never-dispatched create. Restoration now reuses that operation only when no dispatch or success evidence exists. Explicit user cancellation, success and uncertainty remain protected.
- [Slack rate limits](https://github.com/QuackbackIO/quackback/pull/575#discussion_r4061210782): the installed Slack SDK's rate-limit error now maps to a confirmed rejection with its retry delay. Unknown outcomes still require review.

The same pass keeps expired and manually retried Slack app events on the serial Slack queue, preserves webhook-registration errors independently of sync health, and enables outbound status proposals from actual status-listing capabilities. Settings no longer offer event toggles whose adapters do nothing, and setup descriptions distinguish status review from automatic updates. All inbound adapters explicitly declare automatic or review-only status handling; GitHub and Linear can apply verified updates, while the other seven require review.

The duplicate bindings table is removed. Permanent operation keys provide delivery identity; post/ticket external links provide source associations. Initial scheduling, crash recovery and manual retry share one queue-selection helper. All integration hooks return explicit delivery outcomes instead of translating legacy retry booleans. HTTP and SDK rate-limit delays reach the job scheduler. Partial writes remain uncertain, including a Monday item whose follow-up description mutation fails or lacks a result.

Sync health is read from the ledger for the current installation, using attention and successful-delivery indexes. Workers no longer update health projections or sweep every integration. Connection errors remain independent. The existing GitHub inbox channel telemetry remains part of that separate channel flow; it is not evidence of ledger delivery.

These migrations are still unreleased, so the initial migration and privacy trigger are revised directly. There is no bindings migration/importer or backwards-compatibility path for an intermediate PR revision.

## Cross-provider consistency

Provider definitions now own account scope, destination labels/ownership checks,
linked-item behavior, and interactive app execution/scheduling. The shared worker
and history code do not need provider-name allowlists for these capabilities.
Discord validates channel guild ownership when saving and immediately before
sending. Public history still filters provider labels to exclude URLs and secrets.

Signed inbound bodies are durable before parsing or network enrichment. Asana
acknowledges setup challenges before a secret exists and stores the signing secret
from its authenticated registration response. It processes all relevant tasks in
a batch in the worker; failed reads retry from the
receipt. Successful receipts discard the raw body atomically with their normalized
children; only unresolved receipts retain it for retry. Manual status reviews identify the linked source, remote item, and received
status. Unverified destination data can only create a review for a current scoped
link, never an automatic update.

Stripe, Freshdesk, and Salesforce use the same on-demand customer-context contract
and settings control as HubSpot, Intercom, and Zendesk. Their obsolete event hooks
and configuration panels are removed. All authenticated capability paths use the
shared token resolver; configuration and credentials can be read together. Refresh
is serialized, reuses the transaction connection for platform credentials, and
supports GitLab rotation and Salesforce's rejected-read refresh. Trello's fragment
authorization uses a same-origin browser handoff with the normal state/session checks.

The executable template is registered only in tests. It demonstrates adding a
provider without changing the worker/history renderer, including account scope
fencing, delivery, link creation, inbound review, and isolated retry. See the
[provider guide](../apps/web/src/integrations/README.md) for the capability boundaries
and implementation checklist.

## Invariants

- Only work after the recorded start boundary is eligible. Older revisions and historic creates cannot become new deliveries or recovery items. Inbound transport receipts may be recorded before their revision is parsed. New events concerning existing content are eligible, and a user may explicitly link an existing item.
- One operation per logical source, installation and destination. Queue retention never determines whether a change was delivered. Successful operation identities remain after detailed history expires.
- Claims and attempts commit before dispatch. A lease token fences completion; a heartbeat keeps a live attempt owned. Expiry before dispatch can retry; expiry after dispatch becomes uncertain.
- The dispatch marker commits before the network call. A timeout or ambiguous provider response never authorizes blind replay. Transport has a deadline and no automatic network retry.
- Known rejection can retry with the same operation identity. A partial or ambiguous sequence of requests stays uncertain even when its final request was rejected.
- Remote results, scoped local links, notes and completion commit together. If local completion fails, retain remote evidence separately and reconcile it without another remote create.
- Retry and recovery actions have their own durable request IDs and expected versions. Cancel stops future attempts; it does not undo remote changes or claim that an uncertain write never happened.
- Connection identity includes the connection date. Destination identity includes provider scope and target. A replacement connection cannot execute an old request.
- Current source, routing, credentials and requesting principal permissions are rechecked. Removed/private messages and comments cannot be dispatched. Canonical content and current actor identity replace stale event snapshots.
- History requires integration-view permission; recovery requires integration-manage permission and source visibility. Raw payloads, credentials and provider error bodies never reach the browser.

## Product behavior and provider boundaries

| Flow                                      | Behavior                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Post creates / integration notifications  | Queued per destination. Existing success, pending work and uncertainty are reused. Resync does not republish the domain event to unrelated sinks.                                                                                                                                                                             |
| Ticket creates                            | Queued from the current ticket narrative, with source authorization. The ticket links refresh while its panel is open.                                                                                                                                                                                                        |
| Remote content, status or archive changes | Explicit review in Sync history. No current adapter declares a verified conditional write, so the old unconditional mutators have been deleted. Copy the proposal, open the remote item, and preserve its edits.                                                                                                              |
| Inbound status                            | Signature verification precedes durable receipt. Each linked source gets an independent operation; source mutation, activity, notes, outbox events and completion share a transaction. Only applied newer revisions supersede an older update.                                                                                |
| Destination verification                  | GitHub and Linear supply the required destination and revision. The other seven inbound adapters explicitly require review; enabling automatic handling also requires destination/revision evidence. Existing reference-only links are never adopted for sync. A repository-local number is never treated as globally unique. |
| Link-existing recovery                    | GitHub and Linear perform a read-only lookup in the original destination, followed by explicit confirmation. Other providers do not offer an unverified recovery link.                                                                                                                                                        |
| Segment identify                          | Verified receipts are acknowledged only after enqueue commits. Declared attributes and completion commit together. Missing timestamps require review; unknown users are ignored as before.                                                                                                                                    |
| Segment membership                        | Existing dynamic evaluation and per-person outbound intent share a transaction. Execution reads current membership and identity and sends a stable delivery ID. This does not add outbound behavior to manual/SSO membership paths that did not previously sync.                                                              |
| Slack app hooks                           | Existing signed receipt and ledger enqueue commit together. The existing app handler runs through the durable worker; ambiguous app actions are not replayed.                                                                                                                                                                 |
| Unsupported source events                 | Fail closed as review items rather than sending an unverifiable snapshot. Deletion does not grant permission to re-send deleted source content.                                                                                                                                                                               |

The system does not claim provider-side exactly-once delivery. If an external platform accepted a request and the response was lost, there may be no safe way to prove absence. Such work stays visible as uncertain, with cancellation and evidence-based recovery. A historic post or ticket is not automatically adopted. Creating a remote issue from an older ticket is declined; users can explicitly link an existing issue instead.

## History, retention and UI

Every integration has Settings and Sync history tabs; Settings remains the default. History shows successful items, pending work, failures and review items, with filters and cursor pagination. Shared buttons, badges, dialogs, inputs, skeletons, empty states and Heroicons follow the existing settings conventions. A failed link confirmation keeps the entered reference and request identity.

Resolved payloads/results and attempts expire after 90 days. Compact operation identities remain for lifetime deduplication. Unresolved work remains visible. Source deletion or a supported privacy transition purges stored snapshots and attempt details. A selected archive review retains only its link reference and proposal after soft deletion; authorized reviewers can still open that existing link. Hard deletion removes its payload too.

## Release sequence

This is a single offline replacement. There is no compatibility release, legacy importer, backfill command, operator activation gate, or mixed-version runtime.

1. Stop and drain the earlier application and workers, including webhook ingress, event dispatch and Slack app workers. Wait for in-flight requests to end and back up the workspace databases. Old writers must not restart.
2. Apply the new release's migrations through the normal workspace/fleet migrator. Migration 0284 records `integration_sync_start.started_at`, creates the ledger, and deletes retired integration jobs and post-create receipts. Migration 0285 scopes link uniqueness; existing links retain an empty scope as references only. Migration 0286 adds privacy erasure. All are idempotent. No prior delivery becomes a new sync operation.
3. Start only the new release. The planned release containing this change is **0.13.3**, which is the minimum writer version in migration 0285's `safe-after` annotation. If release numbering changes, update the annotation to the actual release containing this implementation. No separately shipped compatibility change is required.
4. Verify `integration-sync`, `integration-sync-sweep` and Sync history on a canary workspace using newly created test items. Check permissions, inbound updates, health and recovery before expanding the rollout.

Existing posts, tickets, integration settings and links are preserved. Old events cannot trigger a new remote create, and old links cannot receive automatic status updates or generate refresh/archive review items. New explicitly established links use the new scope. History shows only new operations. Losing old retry/history continuity is intentional.

The old receipt writer, event-queue integration executor, retry helper, health callbacks, unconditional remote-content writer and archive adapters have been deleted, along with the importer and its CLI.

## Rollback and restore

Pause sync workers and ingress first. Keep the new ledger, scoped links and dispatch evidence. Roll forward with a fix or leave delivery paused. Do not roll back to an old integration writer: it cannot honor the new evidence and may create duplicates.

A database restored from backup is not proof of the external platforms' state. With all workers stopped, quarantine its outstanding operations before resuming:

```sql
BEGIN;
UPDATE integration_sync_start SET started_at = now() WHERE id = 1;
UPDATE integration_sync_operations
SET state = 'uncertain', error_code = 'outcome_unknown',
    lease_token = NULL, lease_expires_at = NULL,
    version = version + 1, updated_at = now()
WHERE state IN ('queued', 'running', 'retry_wait', 'failed', 'auth_required');
COMMIT;
```

An operation that was failed or awaiting credentials at backup time may have succeeded since then, so it must also be quarantined. Advancing the start boundary excludes older create intents and timestamped deliveries replayed from the restored outbox or providers. Reconcile restored source data, especially segment membership, before re-enabling outbound automation. Retain `dispatched_at`, attempts and operation keys. Review restored operations against the platforms; do not reset them to pending or delete tombstones. Cancellation, reconciliation and manually verified links remain the supported recovery paths.

## Validation

Validation uses an isolated PostgreSQL database (`quackback_sync_575`), mocked provider boundaries and scratch migration databases. It never calls provider mutation endpoints. The browser review renders the actual health/history/dialog components with fixture server responses inside a settings frame; it covers desktop, mobile, dark mode, loading/error/empty states, restricted actions and confirmation drafts. It is not authenticated full-application E2E coverage.

Earlier PR validation on 2026-09-21, before the cross-provider consistency changes:

- Full regression (`bun vitest run --maxWorkers=4`): **15,604 passed**, 6 skipped and 1 todo; 1,504 files passed and 3 skipped. PostgreSQL migration replay, gap recovery, concurrency and failure tests are included.
- Final focused integration, settings UI, event and job checks after the last recovery/UI refinements: **506 passed in 73 files**, including restoration after a worker crash, manual Slack recovery, and Monday compound delivery.
- `bun run typecheck`, `bun run build`, and `bun run db:check-drift`: passed.
- Changed-file lint: no errors, with two existing typing warnings in Slack and ntfy tests/handlers. Formatting and `git diff --check`: passed.
- Actual health/history components in the browser: no page errors or horizontal overflow in desktop/mobile, light/dark, loading, failure, empty and restricted-action states; failed confirmation preserves its draft. The health panel displays sync attention and a connection error together, without hiding either.

Cross-provider follow-up validation on 2026-09-21:

- Integration, shared settings, event routing, ticket links, and platform credential
  regression: **630 passed in 84 files**, using the isolated database and mocked HTTP.
- After the final reconnect fence: **31 auth/provider-flow tests passed**. The
  real one-connection pool test preserves refresh serialization without a nested
  global connection. The remote-inspection race test rejects new-install credentials.
- OAuth fragment/gateway and same-origin checks passed, including tenant-origin
  handoff after a shared gateway bounce and rejection of gateway-origin token POSTs.
- Browser checks covered all six customer-context labels at desktop/mobile widths,
  inbound status review in light/dark mode, and failed saves retaining the current
  value. No page errors or horizontal overflow. A separate browser check executed
  the Trello fragment bridge under its CSP, verified fragment removal before POST,
  and checked navigation without a token in the URL. These use fixture responses,
  not live provider authorization.
- Typecheck, production build, changed-file lint and formatting passed. The server-function
  manifest covers all 815 built call sites. Lint retains
  one pre-existing Slack payload typing warning. No migration changes were needed.

The final pre-push full regression run passed **15,675 tests** (6 skipped, 1 todo).
Its only failure was the authorization inventory snapshot for the new Trello POST
callback. The reviewed snapshot now includes that route; its delegated state,
cookie, dashboard-session, and origin gates are covered. All **59 authorization
matrix and OAuth callback tests** passed after the update. Typecheck, production
build, and the **815-entry/call-site server-function manifest** also passed.

The final pre-push review also closed these setup and retention gaps:

- Asana's initial challenge now works before any signing secret is configured.
  The secret is accepted only from the authenticated registration response, as
  specified in [Asana's webhook protocol](https://developers.asana.com/docs/webhooks-guide).
  An unsolicited challenge cannot change the configured secret or enqueue an event.
- Shared setup identifies manual providers from their capability and rejects
  automatic setup without credentials instead of reporting success.
- Raw inbound bodies are removed in the same transaction as successful parsing and
  fan-out; failed reads retain the encrypted receipt for retry.
- The one-connection refresh regression now runs against CI's disposable database
  as well as explicitly selected local test databases. Obsolete Jira auth mocks
  were removed.

A local `EXPLAIN (ANALYZE, BUFFERS)` over 200,000 fixture operations used the success and attention indexes, returning health for 10,000 current-installation operations (100 needing attention) in 0.182 ms. The fixture transaction was rolled back. This is a local query-plan check, not a production benchmark.

Live provider behavior and the offline production replacement still require the release checks above.

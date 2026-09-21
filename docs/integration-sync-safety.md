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

The duplicate bindings table is removed. Permanent operation keys provide delivery identity; post/ticket external links provide source associations. Initial scheduling, crash recovery and manual retry share one queue-selection helper. All 21 integration hooks return explicit delivery outcomes instead of translating legacy retry booleans. HTTP and SDK rate-limit delays reach the job scheduler. Partial writes remain uncertain, including a Monday item whose follow-up description mutation fails or lacks a result.

Sync health is read from the ledger for the current installation, using attention and successful-delivery indexes. Workers no longer update health projections or sweep every integration. Connection errors remain independent. The existing GitHub inbox channel telemetry remains part of that separate channel flow; it is not evidence of ledger delivery.

These migrations are still unreleased, so the initial migration and privacy trigger are revised directly. There is no bindings migration/importer or backwards-compatibility path for an intermediate PR revision.

## Invariants

- Only work after the recorded start boundary is eligible. Older events and creates for older posts/tickets are skipped without creating history or jobs. New events concerning existing content are eligible, and a user may explicitly link an existing item.
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

Verified locally on 2026-09-21:

- Full regression (`bun vitest run --maxWorkers=4`): **15,604 passed**, 6 skipped and 1 todo; 1,504 files passed and 3 skipped. PostgreSQL migration replay, gap recovery, concurrency and failure tests are included.
- Final focused integration, settings UI, event and job checks after the last recovery/UI refinements: **506 passed in 73 files**, including restoration after a worker crash, manual Slack recovery, and Monday compound delivery.
- `bun run typecheck`, `bun run build`, and `bun run db:check-drift`: passed.
- Changed-file lint: no errors, with two existing typing warnings in Slack and ntfy tests/handlers. Formatting and `git diff --check`: passed.
- Actual health/history components in the browser: no page errors or horizontal overflow in desktop/mobile, light/dark, loading, failure, empty and restricted-action states; failed confirmation preserves its draft. The health panel displays sync attention and a connection error together, without hiding either.

A local `EXPLAIN (ANALYZE, BUFFERS)` over 200,000 fixture operations used the success and attention indexes, returning health for 10,000 current-installation operations (100 needing attention) in 0.182 ms. The fixture transaction was rolled back. This is a local query-plan check, not a production benchmark.

Live provider behavior and the offline production replacement still require the release checks above.

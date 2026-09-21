# Integrations

One folder per integration. Everything a provider needs lives in
`src/integrations/<id>/`:

```
src/integrations/<id>/
  server/        # server-only: definition, catalog, hook, inbound, api calls, tests
    index.ts     # exports `<id>Integration: IntegrationDefinition`
    catalog.ts   # the gallery card (name, description, settings path)
  ui/            # client: config panel + connection actions
```

The **framework** (the parts every provider shares) stays outside this folder:

- Contracts + orchestrators: `lib/server/integrations/` (`types.ts`,
  `encryption.ts`, `save.ts`, the inbound/user-sync handlers, `status-mapping.ts`,
  `webhook-registration.ts`, `archive.ts`, `token-refresh.ts`, and the registry
  `index.ts`).
- Shared settings chrome: `components/admin/settings/integrations/` (the header,
  setup card, platform-credentials dialog, health panel, `DestinationPicker`,
  `StatusSyncConfig`, and the `INTEGRATION_SETTINGS` registry).

## Add a new integration

1. **Copy the template**: `cp -r src/integrations/_template src/integrations/<id>`.
2. **Rename** `template` → `<id>` in the folder, the catalog `id`/`name`, and the
   exported `templateIntegration` → `<id>Integration`. (Ids are stable: they're
   stored in the DB and appear in webhook URLs. Use `snake_case`; the one folder
   whose name diverges is `azure-devops` → id `azure_devops`.)
3. **Implement only the capabilities you need** in `server/index.ts`. Every field
   beyond `id`, `catalog`, and `platformCredentials` is optional — delete the rest.
   The full contract is `lib/server/integrations/types.ts`.
4. **Register two lines**:
   - `lib/server/integrations/index.ts`: import `<id>Integration` and add it to the
     registry map.
   - `components/admin/settings/integrations/integration-settings-registry.tsx`: add
     the settings entry (icon, connection actions, setup copy, `renderConfig`).
5. **Reuse the shared UI**: `DestinationPicker` for routing targets, `StatusSyncConfig`
   for status mapping, `NotificationChannelRouter` for notification routing — don't
   hand-roll pickers.

## What keeps it honest

- `folder-conformance.test.ts`: every folder is a registered integration and vice
  versa, each has a `server/index.ts`, and **no provider imports another provider**
  (shared code belongs in the framework, e.g. `webhook-payload.ts`).
- `registry-capability-coverage.test.ts`: capability sets stay consistent (every
  inbound provider declares webhook registration + status listing, every tracker
  declares archive + destinations, ...).
- `integration-settings-registry.test.ts`: every catalog provider has a settings
  entry, none dangle.

## `_template`

`_template/` is a permanently checked-in, compiling, contract-satisfying fixture
(not a live provider — `available: false`). It's typechecked and asserted by
`_template/__tests__/template.conformance.test.ts` every run, so the example can
never rot. Read it first — it's the shortest tour of the contract.

## Durable sync and manual recovery

Integration producers enqueue only a connection reference and encrypted intent through
`lib/server/integrations/sync`. The ordinary event queue no longer executes integration
hooks. Current credentials, configuration and source eligibility are loaded by the sync
worker immediately before dispatch.

Operation identity includes source, installation and destination. Atomic claims, leases,
dispatch markers and attempt evidence prevent a failed local write or queue pruning from
authorizing a duplicate remote create. Integration-only post resync visits every active
link without re-emitting `post.created` to other sinks.

Remote edits and selected archive requests appear in the integration's Sync history.
The unconditional refresh, status-push and archive writers have been removed. Provider
support for automatic remote edits must include a verified conditional-write contract;
a read followed by an unconditional write is insufficient. Verified link-existing recovery
currently uses the read-only `issues.inspect` capability for GitHub and Linear.

Each integration hook implements `IntegrationHook` and returns a `DeliveryOutcome`:
`succeeded` (with optional remote identity), `failed`, `auth_required`, `retry_wait`,
or `uncertain`. Use the shared response/error classifiers; return a retry only for a
confirmed rejection. `retryAfterMs` schedules the next job without blocking the worker.
`withSyncTransport` preserves partial-write and timeout evidence across multiple HTTP
requests. SDK adapters must report intermediate writes with `recordDeliveryOutcome`.

Inbound adapters declare `statusMode: 'automatic' | 'review'`. Automatic handling still
requires verified destination and revision evidence; a flag alone cannot authorize it.
Status-listing capabilities enable mapped outbound review proposals. Catalog badges use
these same facts, so manual review is never advertised as automatic remote mutation.

Read sync health with `readSyncHealth`; never overwrite connection errors after delivery.
The ledger owns delivery identity and existing external-link tables own associations.
No second binding table or health projection is needed.

Canonical post events recover rich-text media through `contentJsonToMarkdown`. Markdown
formatters use `buildIntegrationPostContent` for absolute media URLs and intact attachment
fallback around truncation. Linear uses video-as-image syntax; other Markdown providers
retain ordinary video links.

See [Integration sync safety](../../../../docs/integration-sync-safety.md) for invariants,
provider boundaries, retention, the forward-only start boundary and offline replacement and rollback procedure.

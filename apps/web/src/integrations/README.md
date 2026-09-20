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

## Post delivery and content refresh

Post sync is orchestrated by `lib/server/integrations/post-sync.ts`. Retry resolves only
integration mappings; it never republishes `post.created` to webhooks, AI, notifications,
or workflows. Each destination is handled independently, so a link for one integration
cannot block a missing delivery to another.

Original fan-out and manual retry share `integrationDeliveryKey`: post + integration
instance + destination. Pending/running work is reused; only failed jobs are reset, with
fresh payloads and an after-commit worker wake. Completed receipts survive queue retention.
Pre-upgrade pending jobs are reused by retry too. This prevents duplicate retry jobs; it
is not provider-side exactly-once delivery across a crash after an external API succeeds.

Providers can implement `issues.refreshPost` to update existing linked content using their
native formatter. The orchestrator visits every active link and reports failures even
when other destinations succeeded. Unsupported refresh capabilities are skipped without
blocking other integrations. Linear supplies the first adapter; adding another provider
does not require changing the orchestration or endpoint.

Canonical post events recover legacy rich-text images through `contentJsonToMarkdown`.
Markdown issue/card formatters should use `buildIntegrationPostContent` for absolute media
URLs and intact attachment fallback around truncation. Linear opts into video-as-image
syntax for its ingestion API; other Markdown providers retain ordinary video links.

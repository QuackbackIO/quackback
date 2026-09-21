# Integrations

Each provider owns its protocol and presentation metadata in `src/integrations/<id>/`:

```
server/index.ts    # IntegrationDefinition and capability adapters
server/catalog.ts # gallery name, description, and settings path
server/           # OAuth, provider API calls, signature verification, tests
ui/               # connection actions and any provider-specific configuration
```

The shared framework in `lib/server/integrations/` owns authentication, encrypted
storage, durable operations, delivery classification, authorization, and recovery.
Shared settings components own connection health, destination selection, status
mapping, customer context controls, and sync history.

## Capability boundaries

| Capability                 | Provider responsibility                                                             | Shared behavior                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `hook`                     | Convert an event to a notification or created item; return a `DeliveryOutcome`      | Current-source loading, destination fencing, delivery evidence, retries and history               |
| `linkedItems`              | Declare that created items need lifecycle links                                     | Require remote identity, persist links, propose content/status/archive reviews                    |
| `destination`              | Declare account scope keys, safe label, and any required ownership check            | Hash scope and target, reject stale destinations, filter public labels                            |
| `destinations`             | List selectable containers using the supplied credentials                           | Authenticated picker and dependent selections                                                     |
| `inbound`                  | Verify requests, parse all relevant status changes, declare `automatic` or `review` | Persist authenticated receipts before parsing, worker enrichment, atomic fan-out to current links |
| `issues` / `externalLinks` | Parse, inspect, create, or search where supported                                   | Source authorization and verified link-existing recovery                                          |
| `context`                  | Read a customer by email and return a normalized card                               | On-demand lookup, shared authentication, failure isolation; no event mappings or write queue      |
| `userSync`                 | Normalize inbound attributes and outbound membership changes                        | Durable identify and membership operations                                                        |
| `appHooks`                 | Verify/acknowledge interactive requests and execute their queued work               | Shared ledger, with optional provider queue scheduling                                            |
| `oauth` / `refreshToken`   | Authorization protocol and token endpoint                                           | State/session checks, encrypted persistence, serialized refresh, cache invalidation               |

Providers implement only the capabilities they support. A context lookup does not
need a destination or hook. A notification does not need `linkedItems`. Catalog
capability badges derive from these declarations. Catalog descriptions and settings
copy must describe actual behavior too.

## Add a provider

1. Copy `_template/` into a provider folder. Rename its stable ID, catalog, and
   exported definition. IDs are persisted and used in webhook paths; use
   `snake_case` (`azure-devops` is the folder for ID `azure_devops`).
2. Keep only the needed capabilities and replace the fictional endpoints with
   the provider's documented API. The template is an executable example of
   linked-item creation, destinations, manual inbound review, and context. For a
   notification-only adapter, remove `linkedItems` and return a receipt identity
   if the API supplies one. For context-only adapters, retain just `context` and
   connection configuration.
3. Register the definition in `lib/server/integrations/index.ts` and the settings
   entry in `components/admin/settings/integrations/integration-settings-registry.tsx`.
   These are intentionally separate server and client boundaries. Do not import
   the server registry into client code or provider-reachable shared helpers.
4. Reuse `DestinationPicker`, `NotificationChannelRouter`, `StatusSyncConfig`, and
   `CustomerContextConfig`. Provider UI supplies options and connection forms;
   common history and recovery stay shared.
5. Exercise the provider through the worker, not only its API wrapper. Extend
   `sync/__tests__/provider-contracts.db.test.ts` or use the same transactional
   fixture with mocked HTTP. Verify current content, account changes, remote
   identity, retry boundaries, and useful authorized history. Add protocol tests
   for signature verification, OAuth exchange, and refresh where applicable.
6. Run the integration, framework, and shared settings tests, typecheck, and a web
   build. Review affected settings at narrow and wide widths.

The template is excluded from the live registry (`available: false`). Its tests
register it only inside the test process and exercise delivery, link creation,
manual inbound review, scope fencing, and recovery without editing the worker or
history renderer. Folder, capability, and UI registry conformance tests catch
missing registration and incompatible capability combinations.

## Authentication and reads

Use `getIntegrationAuth(id)` when both credentials and account configuration are
needed, so they come from the same locked snapshot. `getValidAccessToken(id)` is
convenient for token-only callers. Providers must not persist refreshed tokens.
Platform credential reads reuse the refresh transaction's connection, including
on a one-connection pool; concurrent refreshes serialize on the installation.

`withIntegrationReadAuth(id, read)` retries a read once after an explicit 401 and
successful refresh. Never wrap a remote write with it. Refresh adapters may return
rotated refresh tokens, an expiry, and updated configuration. Omit expiry when the
provider uses session policy rather than a published lifetime. Trello declares a
fragment callback: a small same-origin browser handoff clears the fragment and
posts the token through the existing state, cookie, and session checks.

## Durable writes and inbound receipts

Producers enqueue a connection reference and encrypted intent through `sync/`.
The ordinary event queue no longer executes integration hooks. The worker loads
current credentials, configuration, and source eligibility before dispatch.
Operation identity includes source, installation, and provider-defined destination
scope. Atomic claims, leases, dispatch markers, and attempt evidence prevent a
failed local write or pruned job from authorizing duplicate remote creation.

Hooks return `succeeded`, `failed`, `auth_required`, `retry_wait`, or `uncertain`.
Use shared response/error classifiers and bounded `integrationFetch`. Retry only
confirmed rejections. `retryAfterMs` schedules work without blocking a worker.
`withSyncTransport` preserves partial-write and timeout evidence across requests;
SDK adapters must report intermediate writes with `recordDeliveryOutcome`.

Signed inbound bodies are encrypted and persisted before parsing or provider
lookups. Optional handshake handlers only acknowledge challenges; they never accept
events or save secrets. Registration adapters may return a signing secret issued
by the authenticated provider API (Asana), replacing the generated secret. Parsers return one result, a batch, or null for irrelevant events, and
throw on read failures so the worker can retry. Receipt completion, raw-body removal, and status
fan-out commit together. Review-mode events resolve current links and show the
source, remote item, and received status. Missing verified destination data may
support a review of an existing current link; it never authorizes automatic local
updates. Automatic updates additionally require destination and revision evidence.

Remote content, outbound status changes, and selected archive requests become
manual reviews. A provider must supply a verified conditional-write contract
before automatic remote edits can be enabled. Reading and then writing
unconditionally is insufficient. GitHub and Linear currently support read-only
`issues.inspect` for verified link-existing recovery.

Integration-only resync visits every active link without re-emitting `post.created`
to unrelated sinks. Canonical rich text is converted with `contentJsonToMarkdown`;
`buildIntegrationPostContent` keeps absolute media URLs and complete attachments
around truncation. A provider may supply `formatReviewContent` for its Markdown
conventions.

Read delivery health with `readSyncHealth`; the ledger owns delivery identity and
external-link tables own associations. There is no legacy replay path or second
binding table. See [Integration sync safety](../../../../docs/integration-sync-safety.md)
for retention, the forward-only start boundary, and offline replacement/rollback.

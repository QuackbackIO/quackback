# Integration gateway rollout

This branch contains local implementation across tenant and control-plane worktrees. It is not evidence of production deployment or Slack console configuration. Preserve the production phase gates in the implementation prompt; do not enable customer deployments before the internal-tenant tests pass.

## Environment and topology

| Process                  | Variables                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP web/worker            | `REDIS_URL`, `INTEGRATION_GATEWAY_FORWARD_SECRET` (same random 32+ character secret as fleet), `INTEGRATION_SLACK_*` (and other `INTEGRATION_<PROVIDER>_*` as used) |
| Fleet web **and** worker | `QUACKBACK_CONTROL_PLANE_URL=https://app.quackback.io`, `INTEGRATION_OAUTH_GATEWAY_URL=https://app.quackback.io`, `INTEGRATION_GATEWAY_FORWARD_SECRET`              |
| Self-hosted tenant       | Gateway variables unset; platform credentials entered in settings or environment                                                                                    |

CP `CP_ROLE=all` runs the HTTP gateway and forwarder. If roles are split, run a `CP_ROLE=worker` process in addition to `web`; the web process alone only enqueues. Redis must be durable and reachable before enabling the provider hooks. OAuth bounce rate limiting also depends on Redis and fails closed on an outage. Shared client/signing credentials are Railway environment variables on CP and the fleet.

Pooled tenants read the 16 shared OAuth apps from their Railway environment, with no tenant-DB fallback. Self-hosted instances retain DB/env credentials. Workspace-specific API-token integrations and auth-provider credentials retain their existing source.

## Ordered gates

1. Apply CP migration `0092_integration_installs.sql`, set shared OAuth credentials as Railway env vars on CP and the fleet, then deploy the internal install API and OAuth bounce. Test real active and unknown hostnames, platform redirect aliases, unchanged callback queries and no-store responses. Compare the final deployed source SHA and image digest to this change.
2. Apply tenant migration `0274_slack_agent_gateway.sql`, deploy gateway-aware OAuth, credential fallback and registration. Verify Slack install/reconnect, notifications, and a second workspace's conflict response. Run the explicit backfill from a configured fleet process: `bun --tsconfig-override apps/web/tsconfig.json apps/web/scripts/backfill-integration-installs.ts`. It uses `runFleetPass`, prints succeeded/failed/skipped counts, and logs conflicts without stealing bindings. Reconcile conflicts manually. No backfill runs automatically on startup.
3. Deploy CP receivers and forwarder. Confirm invalid Slack signatures return 401, a real signed challenge succeeds, and `hook-forward` is registered. Verify enqueue failure returns 503 and retries use current workspace routing. Verify dead letters are monitored.
4. Apply the Slack manifest, keeping existing tenant OAuth redirect URLs during transition. Confirm request URL verification, command and shortcut registration, distribution settings and agent scopes in the Slack console.
5. Deploy the tenant receiver, Quinn workspace role and Slack worker. Reconnect and enable only an internal tenant. Test streamed mention, DM, slash command, citations, feedback, approve/reject, missing permissions, unlinked email, uninstall/reinstall and duplicate deliveries. Complete real-model Slack evals. Test OAuth for two additional providers and Trello if enabled.
6. Enable customer opt-in only after those gates. Monitor forward latency, terminal 4xx, failed/dead-letter counts, tenant job failures, provider 429s and per-workspace AI usage.
7. Remove old per-tenant redirect URLs and redundant Cloud database credentials only after verification and explicit authorization for cleanup.

## Transport storage and delayed retries

The prompt combines durable raw delivery with a ban on persisted Slack text. Transport is the explicit exception: CP stores authenticated AES-256-GCM ciphertext, with a purpose-derived key and routing metadata bound as additional authenticated data. Tenant jobs use the workspace's existing encrypted payload mechanism. Full fetched thread context stays in memory; assistant event logs contain metadata, usage and feedback. Approved feedback/tickets store the content the teammate intentionally chooses to capture.

Successful tenant jobs discard their payload atomically with fenced completion. CP removes payloads after terminal delivery, keeping only metadata for deduplication. Failed tenant payloads and CP dead letters have a one-hour retention policy. CP runs a cleanup pass every minute while the worker is active; Redis backup retention and a stopped worker can extend physical ciphertext retention. No plaintext provider bodies are stored on CP.

Each forward retains the original provider signature and a fresh gateway HMAC over the exact body. A second purpose-separated HMAC binds the original receipt time to the body. Tenants verify Slack's five-minute signature window against that authenticated receipt time, verify the fresh forwarding envelope against the current clock, and reject receipts older than one hour. Direct self-hosted requests always use the current clock. This preserves the 10-minute retry without accepting unsigned timestamps or weakening direct Slack replay checks.

## Rollback and recovery

Disable **AI assistant in Slack** per tenant to stop new inference. Keep migrations installed: they are additive except the forward-compatible config version. Roll back application code only to a version that understands assistant config v4 or migrate the config back deliberately.

Unset `INTEGRATION_OAUTH_GATEWAY_URL` to revert new OAuth connects to tenant callbacks; re-add those URLs in provider consoles first. Existing installs keep working. Do not rotate the forwarding secret on only one side. Drain encrypted forwarding and dead-letter queues before rotating the forwarding secret, or preserve access to the old key for an explicitly controlled recovery. Unsetting the fleet forwarding secret rejects forwarded hooks and is an emergency cutoff, not a graceful pause.

Inspect failed jobs by metadata; do not dump raw provider payloads into logs or tickets. Replay only after validating current install ownership and the authenticated original receipt age. Never blindly replay a job to an old hostname.

## Local validation

Use an isolated local database, never the shared development database. `TEST_DATABASE_URL` overrides the unit/integration suite's default database. The tenant migration runner checks declared tables/columns, extensions and index postconditions. Drizzle generation currently reports a pre-existing historical snapshot parent collision among 0050–0052; migration 0274 was authored using the repository's existing SQL/journal lineage without rewriting old snapshots.

Focused tests cover OAuth bounce/credentials, installs API/registration, signature gates and replay windows, queue retry classification, receipt deduplication, member linking, thread rendering, proposal permissions, team audience rejection, config migration, read tools and pending-action lifecycle. Five Slack scenarios are registered under `apps/web/evals/scenarios/slack.ts`; run with `bun run evals -- -t slack-` in a configured non-production model/database environment. Model-backed and live Slack tests are separate from unit-test success.

Migration 0274 guards its schema and version upgrade so a repeat application preserves configuration and revisions. Historical migration 0269 is refused on replay because it would downgrade the version 4 default; use the fleet migrator dry-run to inspect any ledger gap before authorizing a repair.

Install registration now verifies the Slack bot token against the claimed team via `auth.test`; the token is never stored on CP. Disconnect failures preserve the local row for retry. Reconnecting to another team enqueues old-binding cleanup transactionally; the cleanup job avoids revoking a binding that has since become current again. Gateway routing reads authoritative ownership and queued deliveries recheck it before forwarding.

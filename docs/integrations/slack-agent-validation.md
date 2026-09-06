# Local validation: Slack assistant and integration gateway

Implemented in two worktrees on `feat/slack-agent-integration-gateway`:

- Tenant: `/home/james/quackback/.worktrees/slack-agent` (base `b8dcf27e5`).
- Control plane: `/home/james/quackback/.worktrees/slack-gateway-cp` (base `c7562d5c`).

## Results

| Check                                                                                                                    | Result                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Tenant migrations against fresh `quackback_slack_agent` local DB                                                         | Passed, including declared table/column and index postconditions                   |
| CP gateway/install API/forwarding/encryption/parity tests                                                                | 56 passed                                                                          |
| Tenant focused unit tests: assistant runtime/tools/config, Slack identity/presentation/decisions, receipt authentication | 267 passed                                                                         |
| Tenant integration/credentials/settings/pending-action database regression suite                                         | 258 passed                                                                         |
| Real-database queue lifecycle, stale-lease payload deletion, feedback aggregates and workspace retrieval                 | 45 passed                                                                          |
| Shared approval-service and Slack decision regression suite                                                              | 29 passed                                                                          |
| Tenant, workspace probe, eval harness and CP typechecks                                                                  | Passed                                                                             |
| Changed TypeScript file lint                                                                                             | Passed with warnings; existing large modules and explicit-any warnings remain      |
| CP production build and client bundle audit                                                                              | Passed                                                                             |
| Tenant widget prerequisite and production client/server build                                                            | Passed                                                                             |
| Slack model evals                                                                                                        | All five passed across latest full run and focused reruns; see qualification below |
| Whitespace/diff checks                                                                                                   | Passed                                                                             |

Suites overlap; these counts must not be added into a unique total.

The model run used the existing development AI configuration, an explicit local base URL, single tenancy and the isolated database. Initial failures exposed an assertion that counted proposals as executed writes, and missing explicit inability-tool guidance; both were corrected. One subsequent aggregate run received malformed DSML tool-call text from the development model. The focused aggregate/proposal rerun passed. This is evidence of the cases working, not a claim of deterministic model behavior or production-model certification.

The eval harness now preserves explicit environment overrides and declares fixture types that were missing for existing connector/skill scenarios. A regenerated CP route tree also exposed the existing workspace tab parser's required-search typing; its input is now marked with `SearchSchemaInput`, preserving the existing default-tab behavior without editing callers.

## Important implementation choices

- Durability and the no-transcript requirement are reconciled with encrypted transient transport payloads. CP authenticates routing metadata as well as the ciphertext. Successful payloads are discarded; failed payload cleanup uses the one-hour policy documented in the rollout runbook. Assistant event logs remain metadata-only.
- Delayed retries carry an authenticated original receipt time as well as a fresh forwarding signature. Direct Slack requests retain the five-minute replay window; gateway retries verify the provider at receipt and expire after one hour.
- Options are empty synchronous responses; the manifest subscribes only to handled events. Native session stop/title handling and manual member linking are not included.
- Workspace conversation search is a separate team-only adapter. The existing customer-scoped summary source is unchanged. Internal-note controls and public-audience refusal have database-backed coverage.
- No live Slack messages, provider-console changes, production migrations, deployments, changelog announcements or credential cleanup were performed.

Production rollout is still gated by [the ordered runbook](./integration-gateway-rollout.md), including real install/reconnect conflicts, internal-tenant Slack interactions, non-Slack OAuth checks, deployment artifact verification and monitoring.

## CP-managed credential settings follow-up

Cloud OAuth credentials are now one encrypted JSON settings object managed at CP `/admin/integrations`. Migration 0092 adds its storage and metadata-only audit. Pooled tenants always read the 16 shared OAuth apps from CP, including Slack gateway signature verification; single-tenancy DB/env behavior is preserved. The editor loads secrets only on an explicit authenticated operator request and does not serialize them into route/SSR data. Tenant credential APIs return managed/configured status only.

Validation on 2026-09-06: 72 CP focused tests passed, with the opt-in database test skipped in the default run. The separate database-enabled run passed 66 tests, including the real migration, encrypted persistence, audit records, concurrent revision conflict and removal checks. Tenant credential suites passed 27 tests. Both typechecks and production builds passed, including the CP client bundle audit. Credential-source lint passed. Counts overlap; do not sum them. No production settings were entered or changed.

CP must be deployed with `INTEGRATION_CREDENTIALS_ENCRYPTION_KEY` and the shared app JSON populated before deploying the updated tenant fleet. Preserve the encryption key with backups. See the CP `INTEGRATION-CREDENTIALS.md` guide and this repository's rollout runbook.

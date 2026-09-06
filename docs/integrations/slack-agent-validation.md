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

## General Cloud settings and startup overlay

The credential follow-up is generalized into **CP → Admin → Settings** (`/admin/settings`), one encrypted JSON document using environment variable names. Migration 0093 renames the settings/audit tables while preserving prior data and revisions. Earlier provider-grouped JSON is converted on read.

The Quackback image launcher loads a single CP snapshot in pooled tenancy before the shell entrypoint, migrations, workers or web server initialize. Saved values override container environment variables, missing keys preserve them, and null unsets them. Running containers retain their snapshot until restart. Self-hosted containers make no CP request. A dedicated fleet bootstrap token is required; customer/per-workspace tokens cannot read the full settings document.

Validation on 2026-09-06:

- 57 tenant tests passed, including environment precedence, malformed/unavailable settings, startup refusal, self-hosted bypass, actual child-process initialization and existing Docker entrypoint behavior.
- 65 CP tests passed with the isolated database enabled, including encrypted persistence, migrations 0092/0093, revision conflicts, audit records, legacy-document conversion and process-lifetime gateway snapshots.
- Both typechecks and production builds passed, including CP's client bundle audit. The standalone container launcher bundles successfully. Focused tenant lint passed.

CP and fleet need `QUACKBACK_CP_SETTINGS_TOKEN`; CP also needs `PLATFORM_SETTINGS_ENCRYPTION_KEY` (the earlier integration encryption key name remains a fallback). Configure the bootstrap URL/token on the containers, deploy the CP migrations and populate settings before the tenant rollout. Restart CP gateway and fleet processes to apply changes. See CP's `PLATFORM-SETTINGS.md` and the tenant rollout runbook. No live deployment, provider configuration or production settings changes were performed.

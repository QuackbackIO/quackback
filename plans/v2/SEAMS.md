# Seam Registry — Planned Edits to Upstream-Owned Files

> Merge checklist for every upstream sync (`02-fork-conventions.md` §7). Each row is an edit the fork
> makes (or plans to make) to a file upstream owns. **Status** is `planned` until implemented; when a seam
> lands, mark it `live`. Rule: every live seam carries a `FORK-SEAM(<feature>)` comment in code, so
> `grep -rn "FORK-SEAM" apps packages` must list exactly the `live` rows below (JSON/Markdown excepted).
> Per-plan detail (why unavoidable, how to re-apply) lives in each plan's Seams section.

## Shared foundation seams (built once, used by all plans)

| ID  | Upstream file                                                     | Seam                                                                      | Used by        | Status  |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------- | ------- |
| F-1 | `packages/db/src/migrate-runtime.ts`                              | Apply fork migration lineage after upstream in `runMigrations`            | all            | planned |
| F-2 | `packages/db/scripts/check-drift.ts`                              | Scope upstream drift diff to upstream schema / exempt `fork_*`            | all            | planned |
| F-3 | `apps/web/src/lib/server/mcp/tools/index.ts`                      | `registerForkTools(server, auth)` at end of `registerTools`               | 10, 20, 30, 50, 60 | planned |
| F-4 | `apps/web/src/components/admin/settings/settings-modules.ts`      | `return applyForkSettingsModules(modules, flags)`                         | 10, 30, 40, 50, 60 | planned |
| F-5 | `apps/web/src/lib/server/domains/principals/principal-repoint.ts` | Invoke fork re-point steps on principal merge                             | 40 (+ any customer-referencing fork table) | planned |
| F-6 | `apps/web/src/lib/shared/labs/registry.ts`                        | `...FORK_LABS_EXPERIMENTS` spread                                         | 50, 60 (+ others as gated) | planned |
| F-7 | `packages/db/src/rbac-catalogue.ts`                               | Fenced fork blocks in `PERMISSIONS`, `PERMISSION_CATALOGUE`, `WORKSPACE_ADMIN_PERMISSIONS`, Contributor list | 10, 30, 40, 50, 60 | planned |
| F-8 | `apps/web/src/lib/server/jobs/definitions.ts`                     | `...FORK_JOB_DEFINITIONS` spread at end of `JOB_DEFINITIONS`              | 40 (+ any scheduled fork job) | planned |
| F-9 | `apps/web/src/lib/server/audit/log.ts`                            | One fenced block of fork members in `AuditEventType` (`account_action.*`, `fork_announcement.*`) | 40, 60 | planned |
| F-10 | `apps/web/src/lib/server/policy/authz-matrix/classifications.ts` | `...FORK_CLASSIFICATIONS` spread for fork gates that use bare `requireAuth()` | 30 (+ any plan with non-permission gates) | planned |

Plan seam tables that list a settings-nav entry, an MCP registration line, a Labs line or catalogue
keys, a scheduled job or audit event types are **satisfied by F-3 / F-4 / F-6 / F-7 / F-8 / F-9 / F-10** and are not counted again below.

## Feature seams

| ID    | Upstream file                                                            | Seam (one line)                                                                 | Plan / phase           | Status  |
| ----- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------- | ------- |
| R-1   | `apps/web/src/lib/server/domains/api/auth.ts`                            | Resolve principal permissions (custom roles) for API keys                      | 10 / 1a (permanent)   | planned |
| R-2   | `apps/web/src/lib/server/domains/api-keys/api-key.service.ts`            | Copy creator's role assignments onto the key's service principal               | 10 / 1a (permanent)   | planned |
| R-3   | `apps/web/src/lib/server/mcp/types.ts`                                   | `permissions` field on `McpAuthContext`                                         | 10 / 1a (permanent)   | planned |
| R-4   | `apps/web/src/lib/server/mcp/handler.ts`                                 | Resolve MCP permissions after `resolveAuthContext`                              | 10 / 1a (permanent)   | planned |
| R-5   | `apps/web/src/lib/server/mcp/tools/helpers.ts`                           | Actors carry permissions; per-tool permission gate                              | 10 / 1a (permanent)   | planned |
| R-6   | `apps/web/src/lib/server/functions/comments.ts`                          | Teammate comment gate (`forkAssertTeammateMayComment`)                          | 10 / 1b                | planned |
| R-8   | `apps/web/src/routes/api/v1/posts/$postId.comments.ts`                   | `assertApiPermissions(auth, [COMMENT_CREATE])` after `withApiKeyAuth`           | 10 / 1b                | planned |
| IE-1  | `apps/web/src/lib/server/domains/conversation/conversation.email-channel.ts` | Per-app inbound reply-address key (`forkInboundAddressKey()`) in `signingKey` (D-C11, permanent) | 20 / 8 | planned |
| C-1   | `apps/web/src/lib/server/workspaces/pool-cache.ts`                       | Configurable `prepare` (only if RDS Proxy pins)                                 | 20 (conditional)       | planned |
| T-1   | `apps/web/src/lib/server/policy/tickets.ts`                              | Escalator-while-watching visibility predicate (approved, D-T6)                  | 30 / 2                 | planned |
| T-2   | `apps/web/src/components/admin/inbox/inbox-detail-panel.tsx`             | `<ForkTierPanel/>` mount                                                        | 30 / 2                 | planned |
| T-3   | `apps/web/src/lib/server/auth/signup-policy.ts`                          | Exempt known email-only requesters in `isAccountCreationAllowed` (hub sign-in, D-T12) | 30 / hub         | planned |
| T-4   | `apps/web/src/locales/*.json` (9)                                        | Append `portal.forkHub.*` keys                                                  | 30 / hub               | planned |
| T-5   | `apps/web/src/components/widget/widget-overview.tsx`                     | `<ForkHubHomeSection/>` after the recent-tickets card                           | 30 / hub               | planned |
| T-6   | `apps/web/src/components/public/portal-header-nav.ts`                    | "Help hub" link to `/hub`                                                       | 30 / hub               | planned |
| T-7…  | Workflow `escalate` action (~15 sites), macro action (3, incl. upstream schema), `events/targets.ts` stage email | See `30-tiered-support.md` later-phase seams | 30 / later (deferred) | planned |
| A-2   | `apps/web/src/components/admin/inbox/inbox-detail-panel.tsx`             | `<ForkAccountActionsSlot/>` mount (same file as T-2 — co-locate in one fork slot) | 40                   | planned |
| A-4   | `apps/web/src/components/admin/settings/security/audit-log-page.tsx`     | Fork event labels in filter (optional)                                          | 40 (optional)          | planned |
| A-5   | `apps/web/src/lib/server/domains/assistant/assistant.runtime.ts`          | Spread fork account-action specs into `extraSpecs` (Quinn, off by default, D-A7) | 40 / 7 (deferred)      | planned |
| P-1…5 | `lib/shared/types/filters.ts`, `domains/posts/post.types.ts`, `functions/posts.ts`, `lib/shared/post/views.ts`, `routes/admin/feedback.tsx` | `'score'` sort member (closed unions)             | 50 / 4                 | planned |
| P-6   | `apps/web/src/components/admin/feedback/table/feedback-table-view.tsx`   | Spread fork sort option                                                         | 50 / 4                 | planned |
| P-7   | `apps/web/src/lib/server/domains/posts/post.inbox.ts`                    | `score` orderBy + cursor branch delegating to fork                              | 50 / 4                 | planned |
| P-8   | `apps/web/src/components/public/post-detail/metadata-sidebar.tsx`       | `extraSections` slot prop                                                       | 50 / 3                 | planned |
| P-9   | `apps/web/src/components/admin/feedback/post-modal.tsx`                  | Pass `<PrioritizationPanel/>` into the slot                                     | 50 / 3                 | planned |
| P-10  | `apps/web/src/lib/server/domains/export/workspace-export.ts`             | Fork exporter in entity list                                                    | 50 / 5                 | planned |
| N-1   | `apps/web/src/routes/_portal.tsx`                                        | `<ForkAnnouncementsBanner/>` mount                                              | 60 / 2                 | planned |
| N-3   | `packages/widget/tsup.config.ts`                                         | `banner` IIFE entry                                                             | 60 / 3                 | planned |
| N-5   | `apps/web/src/lib/server/policy/module-state/ledger.ts`                  | Ledger entry for the banner stream limiter (+ regenerate `MODULE-STATE.md`)      | 60 / 2                 | planned |

## Generated files (regenerate, never hand-merge)

`apps/web/src/lib/shared/permissions.ts` · `policy/authz-matrix/MATRIX.md` · `migration-contract/CONTRACT.md`
· `policy/dep-graph/GRAPH.md` · `policy/module-state/MODULE-STATE.md` (only if a fork ledger entry exists).

## Totals (core phases, excluding conditional/deferred)

Foundations 10 · RBAC 7 (permanent) · Control tower 1 (+1 conditional) ·
Tiered support 6 (2 core + 4 hub) · Account actions 1 (+1 optional, +1 deferred Quinn seam) · Prioritization 10 · Announcements 3.

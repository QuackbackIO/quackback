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
| F-11 | `apps/web/src/lib/server/fleet/schema-floor.ts` | First statement of `assertSchemaFloor` checks the fork ledger + catalogue version (`FORK_MIN_SCHEMA_VERSION`) | 20 (all pooled) | planned |
| F-12 | `apps/web/src/lib/server/content/ssrf-guard.ts` (+ `events/integrations/webhook/constants.ts` write check) | Env allow-list for intranet CIDRs/hosts; loopback + link-local always blocked (`04-…` E-1) | all (blocker for intranet SSO, 40, webhooks) | planned |

Plan seam tables that list a settings-nav entry, an MCP registration line, a Labs line or catalogue
keys, a scheduled job or audit event types are **satisfied by F-3 / F-4 / F-6 / F-7 / F-8 / F-9 / F-10 / F-11 / F-12** and are not counted again below.

The fork's production image is a fork-owned `apps/web/Dockerfile.fork` layered on the upstream image; upstream's
`apps/web/Dockerfile` is **not** edited (`02-fork-conventions.md` §3.3a).

## Feature seams

| ID | Upstream file | Seam (one line) | Plan / phase | Status |
| --- | --- | --- | --- | --- |
| R-1 | `apps/web/src/lib/server/domains/api/auth.ts` | Resolve and trim principal permissions in `requireApiKey`; use at :134/:158 | 10 / 1a | planned |
| R-2 | `apps/web/src/lib/server/domains/api-keys/api-key.service.ts` | Copy creator's role assignments onto the key's service principal | 10 / 1a | planned |
| R-3 | `apps/web/src/lib/server/mcp/types.ts` | `permissions` on `McpAuthContext` | 10 / 1a | planned |
| R-4 | `apps/web/src/lib/server/mcp/handler.ts` | Resolve MCP permissions after `resolveAuthContext` | 10 / 1a | planned |
| R-5 | `apps/web/src/lib/server/mcp/tools/helpers.ts` | Actors carry permissions; argument-aware `forkMcpToolGate(auth, name, args)` | 10 / 1a | planned |
| R-6 | `apps/web/src/lib/server/functions/comments.ts` | Teammate comment gate at start of `runCreateComment` | 10 / 1b | planned |
| R-8 | `apps/web/src/routes/api/v1/posts/$postId.comments.ts` | Require `comment.create`; actor carries permissions | 10 / 1b | planned |
| R-9 | `apps/web/src/lib/server/domains/api/service-actor.ts` | Permissions in `serviceActorFromApiAuth` | 10 / 1a | planned |
| R-10 | 10 files under `apps/web/src/routes/api/v1/**` (tickets, posts, status, conversations ×3, apps ×4) | Permissions on each hand-built service actor | 10 / 1a | planned |
| R-11 | `apps/web/src/lib/server/mcp/server.ts` | `forkMcpResourceGate` inside `scopeGated` | 10 / 1a | planned |
| R-12 | `apps/web/src/lib/server/functions/tickets.ts` | `assertTicketVisible` before `getTicket` at :128, :368, :772 | 10 / 1a | planned |
| C-1 | `apps/web/src/lib/server/workspaces/pool-cache.ts` | Configurable `prepare` (only if RDS Proxy pins) | 20 / 0–2 (conditional) | planned |
| IE-1 | `apps/web/src/lib/server/domains/conversation/conversation.email-channel.ts` | Per-app inbound reply-address key in `signingKey` | 20 / 8 | planned |
| T-1 | `apps/web/src/lib/server/policy/tickets.ts` | Escalator-while-watching read term in `ticketFilter` (D-T6) | 30 / 2 | planned |
| T-2 | `apps/web/src/components/admin/inbox/inbox-detail-panel.tsx` | Shared fork detail-panel slot (tier panel + account actions; A-2 uses the same slot) | 30 / 2 | planned |
| T-8 | `apps/web/src/lib/server/domains/tickets/ticket.service.ts` | `assignTicket` pre/post tier hooks; read-only-escalator write guard in status/priority/delete | 30 / 2 | planned |
| T-9 | `apps/web/src/lib/server/domains/conversation/conversation.service.ts` | `assignTeam` pre/post tier hooks; export two system-message helpers | 30 / 2 | planned |
| T-10 | `apps/web/src/lib/server/domains/tickets/ticket-message.service.ts` | Read-only-escalator write guard in `insertTicketMessage` | 30 / 2 | planned |
| T-11 | `apps/web/src/lib/server/domains/settings/settings.conversation-routing.ts` | Refuse enabling auto-routing while tiers are on | 30 / 3 | planned |
| T-3 | `apps/web/src/lib/server/auth/signup-policy.ts` | Allow known email-only requesters to sign in when sign-up is closed | 30 / 7a | planned |
| T-4 | apps/web/src/locales/*.json (9) | `portal.forkHub.*` keys | 30 / 7b | planned |
| T-5 | `apps/web/src/components/widget/widget-overview.tsx` | Hub section on widget Home | 30 / 7b | planned |
| T-6 | `apps/web/src/components/public/portal-header-nav.ts` | "Help hub" link | 30 / 7b | planned |
| T-12 | `apps/web/src/routes/api/widget/kb-ask.ts` | Private-portal access gate for Ask AI | 30 / 7b | planned |
| T-7… | Workflow `escalate` action (~15 sites), macro action (3), `events/targets.ts` stage email | Deferred phases; see `30-…` | 30 / 6, 8 (deferred) | planned |
| A-2 | `apps/web/src/components/admin/inbox/inbox-detail-panel.tsx` | Uses the T-2 slot (no extra edit if T-2 lands first) | 40 / 5 | planned |
| A-4 | `apps/web/src/components/admin/settings/security/audit-log-page.tsx` | Fork event labels in the filter (optional) | 40 / 5 (optional) | planned |
| A-5 | `apps/web/src/lib/server/domains/assistant/assistant.runtime.ts` | `...forkAssistantSpecs` in `extraSpecs` (Quinn, off by default) | 40 / 6 (deferred) | planned |
| P-1…5 | filters.ts, post.types.ts, functions/posts.ts, post/views.ts, routes/admin/feedback.tsx | `'score'` sort member (closed unions) | 50 / 4 | planned |
| P-6 | `apps/web/src/components/admin/feedback/table/feedback-table-view.tsx` | Fork sort option | 50 / 4 | planned |
| P-7 | `apps/web/src/lib/server/domains/posts/post.inbox.ts` | `score` sort + cursor branch on `(tier, value)` | 50 / 4 | planned |
| P-8 | `apps/web/src/components/public/post-detail/metadata-sidebar.tsx` | `extraSections` slot prop | 50 / 3 | planned |
| P-9 | `apps/web/src/components/admin/feedback/post-modal.tsx` | Pass `<PrioritizationPanel/>` into the slot | 50 / 3 | planned |
| P-10 | `apps/web/src/lib/server/domains/export/workspace-export.ts` | Fork exporter in entity list | 50 / 5 | planned |
| P-11 | `apps/web/src/components/admin/feedback/table/feedback-table-view.tsx` | Batched row-score hook + score chip beside `<FeedbackRow/>` | 50 / 4 | planned |
| N-1 | `apps/web/src/routes/_portal.tsx` | `<ForkAnnouncementsBanner/>` mount | 60 / 2 | planned |
| N-3 | `packages/widget/tsup.config.ts` | `banner` IIFE entry | 60 / 3 | planned |
| N-5 | `apps/web/src/lib/server/policy/module-state/ledger.ts` | Ledger entry for banner stream limiter (+ regenerate `MODULE-STATE.md`) | 60 / 2 | planned |
| E-2a | `apps/web/src/lib/server/storage/s3.ts`, `packages/email/src/ses.ts` | Fall back to the AWS default credential chain when static keys are unset | 04 (conditional: only if IAM roles are mandatory) | planned |
| E-4 | `apps/web/src/lib/server/auth/index.ts` | Don't register the anonymous sign-in plugin when `allowAnonymous=false` | 04 (optional) | planned |

## Generated files (regenerate, never hand-merge)

`apps/web/src/lib/shared/permissions.ts` · `policy/authz-matrix/MATRIX.md` · `migration-contract/CONTRACT.md`
· `policy/dep-graph/GRAPH.md` · `policy/module-state/MODULE-STATE.md` (N-5 adds a fork ledger entry).

## Totals (core phases, excluding conditional / optional / deferred)

Foundations 12 (incl. F-12 SSRF allow-list, a blocker for intranet SSO) · RBAC 11 (R-10 spans 10 files) · Control tower 1 (+1 conditional) · Tiered support 11 (6 core +
5 hub) · Account actions 0 own (uses T-2's slot; +1 optional, +1 deferred) · Prioritization 11 · Announcements 3.

Per the staff review, these counts are an estimate of merge surface, not a target: add a seam whenever an
essential fix needs one. Each seam needs a named owner and a test that fails if it is lost on merge
(`02-fork-conventions.md` §4).

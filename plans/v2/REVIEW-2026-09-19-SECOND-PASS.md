# Second-pass review of plans/v2

Reviewed 2026-09-19. Scope: correctness, feasibility, capability coverage, and continued upstream upgrades. Planning review only; no feature implementation changed.

## Baseline and conclusion

Fetched `origin` and fast-forwarded the current branch to `origin/main` at `3310e2f14` (merge of PR #9). Existing local edits were preserved. During review, another editor committed `701d29fc6` and `39a94c997` and continued editing the intranet revisions. This review includes those newer local revisions, captured in `/tmp/quackback-v2-rereview-latest`, rather than treating the fetched commit as the whole current design. Findings refer to the named sections in that snapshot; source links open the working files, which may continue changing.

**All five capabilities remain feasible, and the revised plans substantially improve the first review. They are not yet an implementation-ready, internally consistent specification.** The remaining blockers concentrate in provisioning/recovery, role ownership/revocation, and tier assignment concurrency. The intranet changes also need a completed inbound-mail contract and an explicit agreement about network-only banner access.

Upstream upgrades remain possible with the proposed fork tables, separate migration journal, isolated modules, marked integration calls, and contract tests. This is still a maintained fork: authorization, migration, assignment, and identity code are behavioral dependencies even when the textual edits are small. Seam counts alone do not establish upgrade safety.

## Codebase and per-plan assessment

The application uses TanStack Start server functions/routes, domain services, a central authorization policy/catalogue, PostgreSQL/Drizzle, workspace-scoped database access, jobs, and realtime pub/sub. Pooled tenancy resolves registry entries into a workspace scope and verifies database identity/schema. Tickets and conversations have separate assignment fields and independent upstream writers. Authentication includes a legacy principal role alongside permission assignments; an empty assignment set can activate the Manager fallback. These are the critical constraints behind the findings below.

- **10 — RBAC/personas:** The argument-aware MCP checks and explicit assignment writer address the previous broad permission-map problem. The remaining blocker is that its authoritative writer contradicts the tower's local-grant preservation rules.
- **20 — Control tower:** Identity mapping, per-user MCP attribution, fork-only migrations, and catalogue reconciliation are much clearer. Migration ordering, revocation guarantees, and the evolving mail design still need changes.
- **30 — Tiered support:** The principal-only lead claim corrects the invalid merge-helper call. Durable escalation rows and transactional paired updates are the right direction, but claiming an operation does not yet serialize its workers, and ordinary assignment hooks still permit races.
- **40 — Account actions:** Team-scoped checks, separate direct/break-glass fields, identity/configuration snapshots, uncertain-response handling, and transactional expiry notifications address the major earlier findings. Completion depends on fixing plan 30's durable escalation contract and tightening routing lifecycle tests. Receiver-side idempotency/status lookup remains a required deliverable for every connected app.
- **50 — Prioritization:** Switch-time invalidation, frozen legacy values, compatibility rules, stale-form checks, a batch portfolio tool, and visible score labels substantially resolve the earlier specification gaps. No additional blocking contradiction found in this pass. The actual scoring framework/scales and weighted Reach remain owner decisions; RICE with provisional defaults must not be described as delivering every pending variant.
- **60 — Announcements** is the fifth feature plan (10 is the shared RBAC foundation). Transactional audit, resolved-at incident queries, and identity refresh are substantially corrected. The new identity-free intranet feed changes the access model intentionally; an SSE subscription race remains.

## Findings requiring changes

### R2-1 — P1: the fork migration precondition does not prevent bypassing a cohort target

[Plan 20 §4.4.2](/Users/adamstavely/Documents/GitHub/quackback/plans/v2/20-control-tower.md) skips a workspace only when its upstream ledger is below its assigned target, then calls `runMigrations(directDsn, { seed: true, verify: true })` and assumes the upstream step is a no-op.

That assumption fails when a workspace has reached an older cohort target but the new image contains later upstream migrations. The runner has no target-version argument and calls Drizzle over the whole migration directory: [migrate-runtime.ts:202](/Users/adamstavely/Documents/GitHub/quackback/packages/db/src/migrate-runtime.ts:202), especially line 257. In addition, ordinary pool acquisition calls `ensureWorkspaceSchemaCurrent`, which catches up to **all bundled migrations**, before checking the floor: [pool-cache.ts:303](/Users/adamstavely/Documents/GitHub/quackback/apps/web/src/lib/server/workspaces/pool-cache.ts:303), [ensure-schema-current.ts](/Users/adamstavely/Documents/GitHub/quackback/apps/web/src/lib/server/fleet/ensure-schema-current.ts).

**Required change:** Define how code versions and cohort targets interact. Either require the upstream ledger to contain every migration bundled in that particular runner image before using the full runner, or provide a fork-only migration/seed path. If different cohorts may remain on older targets, their serving images must also respect that arrangement; a control-plane target alone does not constrain the existing request-path catch-up.

**Acceptance test:** Run a new image against a tenant already at an intentionally older target. Assert that neither `fork-migrate` nor a scoped request applies the withheld upstream migration.

### R2-2 — P1: resume/reconciliation can require a workspace scope that cannot yet be acquired

[Plan 20 §4.4.2–4.4.4](/Users/adamstavely/Documents/GitHub/quackback/plans/v2/20-control-tower.md) enters a workspace scope to reconcile templates before writing the catalogue-version marker. Resume calls that command while the workspace is still suspended, then marks it active afterward.

`withWorkspaceScopeById` goes through the registry, which refuses suspended workspaces: [fleet.ts:147](/Users/adamstavely/Documents/GitHub/quackback/apps/web/src/lib/server/workspaces/fleet.ts:147), [resolver.ts:151](/Users/adamstavely/Documents/GitHub/quackback/apps/web/src/lib/server/workspaces/resolver.ts:151), [registry.ts:371](/Users/adamstavely/Documents/GitHub/quackback/apps/web/src/lib/server/workspaces/registry.ts:371). An old catalogue marker can independently make the new F-11 floor refuse the scope before reconciliation can update the marker. Raising floors in a later release reduces this problem for active tenants, but does not resolve a tenant suspended across several releases.

**Required change:** Specify an unroutable maintenance state/scope or a direct-connection reconciliation path that preserves tenant identity verification without requiring normal serving eligibility. Complete migrations, seeds, template reconciliation, and marker updates before enabling the ordinary serving scope. Do not publish a success marker before its work commits.

**Acceptance test:** Suspend a tenant before multiple catalogue releases, raise the serving floor, then resume it with the newest image. Include crashes between every stage; no public route becomes usable early.

### R2-3 — P1: RBAC and tower sync specify incompatible ownership rules

[Plan 10 §4.8](/Users/adamstavely/Documents/GitHub/quackback/plans/v2/10-rbac-persona-extensions.md) says tower sync always invokes an authoritative assignment writer that removes every undesired workspace role, including locally granted roles. Its verification also treats workspace grants without tower provenance as violations. [Plan 20 §4.3.2](/Users/adamstavely/Documents/GitHub/quackback/plans/v2/20-control-tower.md) says other local roles are never touched and an `adopted_local` role survives tower removal. The plans also define different provenance records and different empty-assignment handling.

These cannot be implemented literally through the same writer: local grants will either be unexpectedly deleted, or the plan 10 deploy assertion will reject the state plan 20 explicitly permits.

**Required change:** Choose one policy: tower owns the entire role set for managed principals, or tower owns only its grant contribution. Define one authoritative writer contract, how the two provenance tables relate if both remain, what legacy-role changes do to local grants, and exactly when sentinel versus legacy `user` is required. Make assertions test that same policy.

**Acceptance test:** Locally grant a role, add the same role through the tower, remove the tower grant, change legacy role, then run seed/migration/reconciliation. Verify the agreed surviving permissions at every step.

### R2-4 — P1: the claimed immediate/15-minute revocation guarantees are not established

Two independent issues remain in [plan 20 §4.3.2 and §4.5.4](/Users/adamstavely/Documents/GitHub/quackback/plans/v2/20-control-tower.md):

1. Disabling a tower user is treated like removing their last tower role, which can retain local grants and a teammate legacy role. The plan then claims MCP fails immediately because the principal becomes `user`. That conclusion is false when local grants remain. The current OAuth JWT handler verifies the token and re-reads the principal's role; it does not look up the revoked OAuth token row on that path: [handler.ts:96](/Users/adamstavely/Documents/GitHub/quackback/apps/web/src/lib/server/mcp/handler.ts:96).
2. Where the IdP has no directory API/SCIM, a 15-minute **tower** session cap does not force a user with an existing tenant session or token to revisit the tower. Their app access can continue. Even a polling job every 15 minutes leaves additional sync latency, so it is not by itself a hard end-to-end maximum of 15 minutes.

**Required change:** Treat account disablement separately from grant ownership, with an effective tenant-level denial on every relevant authentication path. Require a supported directory synchronization mechanism, or enforce a bounded entitlement lease at the tenant. State whether 15 minutes is a target or a hard maximum and budget polling, queues, retries, and failure behavior accordingly.

**Acceptance test:** Disable a locally privileged tower-managed user while they continue using an already issued app session and MCP JWT without visiting the tower. Repeat with IdP/sync unavailable.

### R2-5 — P1: one durable escalation row does not imply one execution of its steps

[Plan 30 §4.2](/Users/adamstavely/Documents/GitHub/quackback/plans/v2/30-tiered-support.md) resumes an existing operation for duplicate requests and in a recovery job. Its unique indexes prevent two different outstanding operations, but not two workers processing the **same** operation simultaneously.

Two retries can both observe `converting`, find no ticket, and each call `createTicketCore`. A JSON marker is not a uniqueness constraint; the unique conversation link can reject the second link after a second ticket already exists. Likewise, `distributeToTeamMember` changes its round-robin cursor outside the apply transaction. A crash after that change but before storing the pick causes recovery to distribute again, even with only one worker.

**Required change:** Define operation ownership/locking and crash recovery, including retries of the same key. Make ticket creation durably unique per escalation operation. Persist the agent choice atomically with any cursor advancement, or explicitly relax the “once” guarantee. Use atomic deduplication for effects promised once; a “find marker, then insert” check alone is insufficient with concurrent runners. Also order stateful effects across successive escalations, so an older pending reason/SLA effect cannot overwrite a later transition.

**Acceptance test:** Race two identical submits with the recovery job, and crash immediately after ticket creation and cursor advancement. Assert one conversion ticket, one applied move, and the agreed distribution/effect semantics.

### R2-6 — P1: ordinary assignment can still automatically undo escalation

[Plan 30 §4.6](/Users/adamstavely/Documents/GitHub/quackback/plans/v2/30-tiered-support.md) checks a pre-hook, allows upstream's unconditional assignment update, and mirrors the pair in a subsequent transaction. A workflow can pass the pre-hook while the conversation is at T1, pause, then write T1 after another transaction escalates the pair to T2. A row lock delays that upstream update; it does not invalidate the stale authorization/transition check. The plan explicitly accepts the last-writer behavior even though it promises no automatic de-escalation.

The underlying writes are unconditional: [ticket.service.ts:744](/Users/adamstavely/Documents/GitHub/quackback/apps/web/src/lib/server/domains/tickets/ticket.service.ts:744), [conversation.service.ts:1542](/Users/adamstavely/Documents/GitHub/quackback/apps/web/src/lib/server/domains/conversation/conversation.service.ts:1542).

Crash recovery by whichever side has the later general `updated_at` is also insufficient. Unrelated edits can advance that timestamp. It cannot reliably identify the latest assignment or reconstruct transitions lost between the upstream write and post-hook.

**Required change:** Validate and apply ordinary team changes under the same row lock/transaction or a checked assignment version/CAS, with pair updates and durable transition/outbox recording in that transaction. If temporary disagreement is intentionally accepted, record a dedicated assignment version/event atomically with the original update; do not infer it from general timestamps.

**Acceptance test:** Pause an automated assignment after its pre-check, escalate to T2, resume the automation, and confirm it cannot return the pair to T1. Kill the process between writes and make an unrelated edit before recovery.

### R2-7 — P1: finish the IMAP router contract before declaring intranet inbound mail feasible as specified

The new header in [plan 20](/Users/adamstavely/Documents/GitHub/quackback/plans/v2/20-control-tower.md) correctly recognizes that [the upstream IMAP scheduler](/Users/adamstavely/Documents/GitHub/quackback/apps/web/src/lib/server/domains/conversation/conversation.email-imap-queue.ts:47) refuses pooled tenancy and proposes a dedicated fleet router. This resolves the earlier assumption that `IMAP_*` alone would suffice. However, the reviewed snapshot still retains SES/Lambda details in §4.11/Phase 8, while [04 §3](/Users/adamstavely/Documents/GitHub/quackback/plans/v2/04-intranet-deployment.md) describes inbound IMAP under a configuration-only baseline.

There is also a concrete interface mismatch: upstream `pollOnce` passes **parsed email** to its callback, whereas the proposed router must POST the original raw MIME to the existing inbound door. `fetchUnseen` exposes the raw message, but `pollOnce` discards that representation before invoking the callback: [conversation.email-imap.ts:34](/Users/adamstavely/Documents/GitHub/quackback/apps/web/src/lib/server/domains/conversation/conversation.email-imap.ts:34), line 78.

**Required change:** Complete one router specification using a raw-message polling loop or a narrowly extended adapter. Specify a trusted envelope-recipient source preserved by the internal mail server, multi-recipient behavior, delivery acknowledgement versus mark-seen, duplicate/retry handling, poison-message quarantine, and singleton/claim behavior across replicas. Keep routing separate from tenant ingestion and retain the per-app address signature. Update 04, the detailed phase, image contents, and operational tests to match.

**Acceptance test:** Deliver cold mail and replies to two tenants, include BCC/multiple recipients, retry after an accepted delivery but before marking seen, and verify no cross-tenant delivery or permanent message loss.

### R2-8 — P2: announcement SSE has a read-before-subscribe gap

[Plan 60 §4.6](/Users/adamstavely/Documents/GitHub/quackback/plans/v2/60-announcements-banner.md) computes/sends the initial DB revision in step 3 and subscribes to pub/sub in step 4. A publish committed between those steps is absent from both the initial revision and the live subscription. A healthy connected viewer can therefore miss an update until a later refresh, contrary to the immediate-push expectation. Reconnect catch-up alone does not close this window.

**Required change:** Subscribe first, then read/send the current revision, with ordering/deduplication so an older initial frame cannot regress a newer event. Alternatively, re-read after subscribing. Keep the periodic refresh as recovery, with its freshness bound stated separately.

**Acceptance test:** Publish between initial revision acquisition and subscription; the open portal and embed must receive the new content without reconnecting or waiting for the periodic poll.

### R2-9 — P2: the intranet AI configuration instructions can enable unintended features

[04 §3](/Users/adamstavely/Documents/GitHub/quackback/plans/v2/04-intranet-deployment.md) says leaving a feature model unset disables it and identifies `AI_ASSISTANT_MODEL` as the override for both Quinn and Ask AI. Actual [models.ts:39](/Users/adamstavely/Documents/GitHub/quackback/apps/web/src/lib/server/domains/ai/models.ts:39) resolves `override ?? roleDefault`; an unset feature inherits `AI_CHAT_MODEL`. Help-center answers use `AI_HELP_CENTER_MODEL`.

**Required change:** Document explicit disable sentinels (`off`/`false`/`none`, as supported by the resolver), role-default inheritance, and the correct feature-to-model mapping. Test the selected internal proxy against each enabled feature's required API behavior before claiming offline parity.

## Questions and acceptance criteria still needing decisions

1. **Who owns managed users' local grants?** Resolve R2-3 before implementing either assignment service. Does disabling an employee override every local grant? It should be an explicit account-state rule.
2. **What is the employee-authentication boundary?** The revised tower acknowledges that public portal reads are permitted by Quackback and protected by the edge; plan 60 now proposes proxy exemptions for identity-free embed paths. This can be a deliberate intranet design, but it is not app-level SSO on every read. Confirm that “Everyone” announcements may be readable by anyone with network reachability to those exempt paths. Restrict any proxy-bypass backend route to the intended service callers. Update 04's blanket “edge and Quackback SSO” wording accordingly.
3. **Which IdP capabilities are actually available?** SCIM/directory API, immutable subject mapping, verified-email claims, group claims, private TLS trust, and the actual revocation requirement determine the tower design. “Silent reauthentication” is not a substitute for tenant revocation.
4. **How will SSO-only bootstrap close?** The revised tower correctly fails provisioning if its email-OTP negative probe succeeds, but 04 still leaves disabling OTP unverified. Resolve the exact configuration or seam before treating provisioning as build-ready. Also rehearse enforcement/provider bootstrap from a completely new tenant.
5. **Are tiers routing conventions or hard authorization boundaries?** The plans accept some manual assignment overrides and conversation-path access while restricting former ticket handlers. Confirm those behaviors meet the desired capability, rather than implying a hard security separation between tiers.
6. **Account-action policy:** Confirm direct Owner/Admin break-glass, current-team approval, material-change reapproval, and the immutable employee identifier accepted by each receiver. Explicitly guard routing/re-routing on `status = pending_approval AND expires_at > now()`; serialize attempts with cancel/expire/approve. Test a cancelled or expired request with unfinished routing, and concurrent routing retries. The current durable sub-state description should be made concrete at these boundaries.
7. **Scoring:** Resolve D-P1–D-P4 and confirm current-before-legacy ordering, frozen scores, switch-time invalidation, and the acceptable age of weighted-Reach data. These are product choices, not defects in the revised design.
8. **Announcement freshness:** Confirm the accepted five-minute status-incident freshness, identity-free everyone feed, browser-local dismissal, and the narrower embed branding behavior. Immediate announcement writes and periodically discovered incident changes have different guarantees.

## Upstream-upgrade requirements

Preserve the separate fork schema/journal and avoid renaming or rewriting upstream tables. Add the necessary transactional assignment integration rather than retaining an incorrect two-call design solely to minimize changed lines. Keep that integration narrow and documented.

Before accepting an upstream update, test the behavioral contracts that the fork depends on: legacy-role fallback and seed healing; MCP token/permission enforcement; principal re-point registry coverage; ticket/conversation assignment and event semantics; migration runner and pool acquisition behavior; inbound MIME/signature handling; and auth/provider bootstrap. Run existing repository guardrails as well as fork contract tests.

The decisive upgrade rehearsal uses a populated fleet with active and suspended tenants, local and tower-owned grants, pending escalations/account actions, and existing prioritization history. Apply an upstream migration plus fork/catalogue changes, then resume an old suspended tenant. Validate tenant isolation, grants, data, recovery, and old-code/new-schema compatibility. Passing only a new empty installation does not establish upgradeability.

## Validation limits

This pass was a static plan-to-source review. No planned implementation exists to execute, and no feature/runtime tests were represented as passing. The previous review remains unchanged. The major earlier MCP, lead-claim, account-action response/constraint, prioritization, and announcement audit findings are substantially addressed in the new design; the findings above are the remaining corrections and verification gates.

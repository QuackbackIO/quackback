# Quinn product implementation

Source: `/home/james/Downloads/quinn-product-implementation-spec-reconciled.html`, revision 4 (18 September 2026).

Implementation branch: `feat/quinn-product`, based on the specification's `feat/conversation-lifecycle` commit `9a10dd86ff364ca4a3cad0d0dc8252314ce33855`. The original branch and the unrelated edits in the main checkout are preserved.

## P0 — correctness

Implemented:

- Use all eight canonical citation kinds throughout structural completion validation and citation assembly.
- Customer orchestrator sends activity only while generating; candidate text cannot reach visitor realtime events. Copilot's private streaming remains available.
- Interpret connector/MCP failures and registered built-in failure envelopes before recording audit success or executed-action metrics. Existing feedback linkage remains successful.
- Duplicate autonomous writes inspect the existing receipt and distinguish succeeded, failed, denied, and unconfirmed attempts without dispatching again.

Validation: 241 targeted tests passed, none skipped, including PostgreSQL audit tests, in the isolated `quackback_quinn_product` database. Baseline database was migrated from empty through 0284. Full application and workspace-probe typechecks pass after generating the route tree and widget bundle. No new migration in P0.

Rollback: revert the P0 commit. No data rewrite or runtime retry activation occurred. Existing historical audit rows are not reclassified.

## UX0 — shared shell and source selection

Implemented:

- One Quinn navigation group, Overview, Knowledge, Guidance, Connections, Deploy and Improve; authorized legacy Agent/Copilot/Skills aliases remain available. Inbox Copilot is labelled Ask Quinn.
- Guidance projects existing rules, skills, customer instructions and managed workspace instructions without copying or truncating them. Saving preserves each entry's existing role assignments; new entries deliberately select one supported use until canonical bindings exist.
- Independent customer/teammate master switches, including web pages; document/web-page source rows under their types. Help Center article metadata has per-use checkboxes and the list has an Excluded from Quinn filter.
- Migration 0285 adds default-on source-use columns. Existing adapters enforce them alongside visibility. Customer citation clicks recheck current source/type use, publication and visibility and serve current public text with no-store headers; excluded/private sources return unavailable.
- Existing deployment cards remain immediate-save controls. Quinn inactivity controls are in channel settings with permission checks, retained drafts, and existing revision conflict protection.

Validation: 1,099 assistant/settings/component tests passed, with three live-model opt-in tests skipped. Another 86 Help Center/API/citation-renderer regressions passed. New PostgreSQL tests exercise both lexical and semantic document exclusion, independent web-page use, and old article citation revocation. Application/workspace typechecks pass. Migration 0285 applies to the prior schema; the fresh-database drift check passes with no drift. Browser checks on desktop and 390px mobile covered all five pages, a real Guidance save, and the legacy Agent knowledge alias; no page errors or horizontal overflow. Changed-file lint reports only the existing oversized-file warnings in conversation.query.ts and assistant.runtime.test.ts.

Deployment prerequisite: migrate workspace databases through 0285 and set the consuming build's schema floor accordingly before rollout. The additive columns may remain during rollback; old code ignores the new exclusions, so reverting enforcement is not a privacy-preserving rollback for workspaces that use exclusions. No deployment has been performed.

Remaining UX integration follows the later gates: canonical shared Guidance bindings; durable run/action inspection; exact-candidate evaluation/publication; in-flight evidence revocation fences; richer source views and authenticated teammate citation revalidation. Current customer source views serve plain text, never private original storage URLs.

## P1 prerequisite — one active involvement

Implemented in migration 0286 and the involvement service: serialize opens on the conversation row, return the existing active identity, and enforce a partial unique index in PostgreSQL. New opens join the caller transaction. The migration reports up to 20 conversation UUIDs with legacy active duplicates and stops; it never rewrites outcomes. Repair requires inspecting transcript/history and explicitly choosing the canonical active record while preserving audit history.

Validation: 52 targeted concurrency/involvement/turn tests passed, including independent PostgreSQL connections, caller rollback, direct duplicate rejection, and duplicate-migration preflight. Full typechecking and a fresh-schema drift check pass. The broader assistant pass found only three Guidance assertions affected by the browser-created test rule; removing that test fixture and rerunning the Guidance service suite passes. Runtime retrying turns remains unchanged.

Rollback: retain the unique index and serialization where possible. Removing the index permits duplicate active rows again; no history was rewritten by this migration.

## Outstanding acceptance gates

End-to-end validation is recorded in [the functional test report](quinn-product-test-report.md): 21 product scenarios pass against both development and compiled production servers, and all 28 opt-in PostgreSQL lifecycle tests pass. Testing fixed article Markdown preservation and URL form submission. The full repository run has 15,634 passes and 13 failures reproduced on the pre-Quinn baseline; two live local-model tests also fail on both versions. These results do not close the unimplemented gates below.

- P1–P2: durable intents/snapshots, transactional intake, publication and takeover fencing, independent-connection concurrency tests.
- Connection gate: independent policies per use, reviewed catalog contracts and full input validation.
- P3–P4: replayable receipts, uncertain-effect reconciliation, queued approvals, workflow delegation/recovery.
- Feedback gate: internal post audience/provenance and every public reader/side-effect boundary before automatic capture.
- Guidance gate: lossless canonical entries and atomic role bindings before shared authoring.
- P5–P6: passage indexing and evidence/answer validation.
- P7–P8: exact-candidate evaluation/publication, rollback, run inspection and operations.
- P9: channel-specific eligibility and richer procedures/follow-up.

No publish/test controls, autonomous email, automatic internal feedback capture, or write-capable retries are enabled by these changes. No push, merge or deployment is authorized by the specification.

## Critic corrections and mockup follow-up

Customer-disabled source types now remain usable for teammate analysis while marking retrieved provenance internal, preventing those results from becoming insertable customer drafts. A guidance update after concurrent deletion rejects before success audit and keeps the editor draft. Overview and Deploy distinguish missing AI configuration from enabled deployment preferences.

Added All/Always/Situations guidance filters, a permission-gated Help Center management link, and Quinn naming in deployment/performance copy and the English catalog. Regression coverage includes the real two-session deletion case. The remaining connected-screen work is tracked in [mockup parity](quinn-mockup-parity.md); this correction slice does not complete the later backend gates.

Validation: 506 targeted tests, application/workspace and E2E typechecks, production build and server-function manifest verification pass. The expanded development browser suite passes all 25 checks (23 product scenarios plus setup/cleanup). A production run with configured storage exceeded the five-second upload assertion for PDF/DOCX, though both requests subsequently completed; isolated production verification disables external AI and storage. Changed-file lint has only existing oversized-file and explicit-any warnings in the toolspec/runtime test files.

## Mockup integration pass

Guidance now uses the mockup's split list/editor layout, retaining full legacy text, current immediate-save semantics and explicit discard protection when changing selection. Knowledge adds a shared Add source entry point, source metadata and an authorized stored-text preview; private storage URLs are never returned. Connections presents built-in policies in independent customer/teammate columns, including reset-to-default and managed-state handling. Deploy has explicit Email and managed Workspace/Slack rows, with identity/voice progressively disclosed.

Overview and Improve now expose real, bounded conversation lists through the existing inbox row policy. Review signals are unexpired proposals, recent latest-involvement handoffs and low ratings after that involvement began. Live conversations require a current active involvement and open conversation. Historical handoffs, expired proposals, spam and inaccessible rows are excluded. This adds read-only visibility over existing records; it does not claim recoverable approval execution or durable run inspection.

Validation so far: 1,135 targeted assistant/settings/component/authorization tests passed, with three live-model checks skipped. Four new PostgreSQL tests cover review-list authorization, current involvement, lifecycle, expiry and date filtering. Development browser acceptance: 27 checks passed, including source-preview anonymous replay denial and independently persisted built-in policies. Application/workspace and E2E typechecks pass. Desktop screenshots across all six Quinn pages showed no horizontal overflow or browser exceptions. All 27 checks also pass against the final compiled production server. All six Quinn pages pass the 390px mobile check without overflow, visible errors or browser exceptions. The final server-function manifest has 825 entries and 825 call sites; mockup-pass lint is clean.

Remaining mockup differences are tracked explicitly in the parity document. Canonical shared guidance, reviewed independent external policies, exact-candidate Test/Publish, recoverable actions/approvals, internal feedback capture and full run/source-generation inspection still require the ordered backend gates; the UI does not advertise these as implemented.

## Step 3: durable intent, snapshots and publication fences (P1, P2)

Implemented:

- Migration 0287 adds `assistant_runs` (one live parent enforced by a CHECK, a unique trigger key, a partial unique index over executing runs, status/phase/outcome vocabularies, input revision, state version, diagnostic job id and lease token, bounded attempt and token counters), `assistant_run_steps`, `assistant_run_evidence`, an immutable `assistant_effective_snapshots` keyed by content hash, `conversations.assistant_revision`, a nullable `conversation_messages.assistant_run_id` with a partial unique index allowing one terminal customer-visible message per run, and `assistant_request_receipts` for the HTTP retry boundary. Expand-only.
- `requestAssistantTurn(tx, ...)` runs inside the transaction that persisted the customer message: it bumps the invalidation counter, supersedes older uncommitted runs, writes the run intent and enqueues the turn job with `maxAttempts: 1` on the same transaction. A rollback leaves no run and no job.
- `advanceAssistantRun(job)` claims execution ownership using the queue's lease token, persists the effective snapshot, generates through the existing orchestrator gates, and holds no transaction across the model call. `commitAssistantOutcome(tx, ...)` verifies the input revision, the run status, the run's lease token, the queue row's own lease, the run state version, closed/snoozed/paired/handed-off state and the absence of a terminal message, then commits the transcript message, the run result, the involvement update, the inactivity ownership (migration 0284's trigger derives it from the same insert) and the outbox event together.
- One lock order is documented and used by claim, publication and recovery: conversation row, then run row, then job row.
- Invalidation rides each transition's own statement: customer message, teammate reply, assignment, team assignment, handoff, status change, close, reopen, snooze, wake, spam filing, restore from spam, assistant auto-close, inactivity follow-up and close, and message deletion.
- `ASSISTANT_EXECUTION_MODE` selects `durable` (default) or `legacy`. Legacy restores the previous post-commit fire-and-forget call unchanged.
- An optional `clientMutationId` on the visitor send contract is claimed in the same transaction as the message, so a retried first send returns the original conversation and message instead of creating a second thread. The receipt is bound to a request digest; the same key with different content is rejected. Clients that omit it are unaffected.
- The visitor stream falls back to the durable run row when no ephemeral activity trace exists, so a reconnect after a worker death still shows a turn in flight. Lifecycle only: no trace text, evidence or model detail.

Validation: 14 cases in `assistant/__tests__/assistant-run.durability.db.test.ts` (11 fence and concurrency cases plus 3 that drive the executor end to end with a barriered fake model) and 3 retry-boundary cases in `conversation/__tests__/conversation-request-receipt.db.test.ts`, all on real PostgreSQL with committed transactions, independent connections and the real queue lease and reaper. Each fence was checked by disabling it and confirming the matching case fails. These suites run against a dedicated `quackback_quinn_runs` database, following `conversation-inactivity.db.test.ts`: they commit rows on purpose, and several suites sharing a database assert whole-table state. Create and migrate that database before running them; they are inert against any other `TEST_DATABASE_URL`.

Effective gates: durable execution is on by default for widget-source customer turns only. Workflow `let_assistant_answer` still uses the legacy executor; durable delegation is P4. No write-capable retries: the turn job stays at one attempt. The snapshot is captured and correlated to the run; executing _from_ a frozen snapshot is P7.

Rollback: set `ASSISTANT_EXECUTION_MODE=legacy`. New customer messages stop creating run intents and resume the previous post-commit call. Outstanding unpublished runs are fenced on their own attempt (the invalidation counter has already moved, or the conversation state check refuses them) and can be cancelled explicitly with `cancelOpenAssistantRuns`. Already-committed transcript and delivery work stays durable. The schema and receipts are additive and remain in place; reverting the code does not replay historical messages.

Remaining in this area: durable workflow delegation and recovery sweeps (P4), replayable tool receipts and approvals (P3), run inspection surfaces (P8), and the semantic validator (P6). Cold inbound email and GitHub inbound mutate conversations with direct inserts and do not bump the counter; neither can carry a durable Quinn run today, because the automatic turn gate requires `source = 'widget'`.

## Step 4: connection policies independent per use (connection gate)

Implemented:

- Migration 0288 adds `connectors.profile_policies`, `connectors.tool_reviews`, `connectors.catalog_revision`, `connectors.policy_version` and, on `assistant_pending_actions`, `origin_profile` and `policy_version`. Expand-only and replay-safe: every statement is `ADD COLUMN IF NOT EXISTS`, so a second run against a database that already carries the effect changes nothing.
- Policies are keyed by use (`agent` for customer conversations, `copilot` for teammates, `workspace` for the linked surface). Resolution runs the hard availability gates first (reviewed contract, enforceable input schema), then the exact per-tool override, then that use's group default. A use with no record of its own resolves to never; it never reads another use's record. New records start at reads always, writes approval.
- The old shared map is projected into the uses a connector is ALREADY assigned to, never into others, with provenance recorded on each projected record. The migration carries no backfill because it must replay as a no-op, so the projection runs lazily in code on first read (`ensureConnectorPolicyState`), with NULL as the "not projected yet" sentinel and a `coalesce` write so a concurrent reader cannot clobber it. Deployments that never read a connector row leave it unprojected and unreachable, which is the same answer.
- Discovery no longer lets a new tool inherit a group default. Each tool carries a reviewed contract (input schema hashed over canonically sorted keys, plus the read-only and destructive hints), and a tool that is new or whose contract moved is unavailable to every use until an authorized teammate reviews it. Tools a connector already had are grandfathered at their current contract, and that baseline is persisted rather than derived, so a change made after the gate shipped is still visible. The catalog revision moves only when something actually changed, and a review is refused when the revision has moved since the page was rendered.
- Input validation is exact and runs before dispatch: enums, integer-ness and bounds, nested objects, array items and lengths, required properties, and a 32 KiB ceiling on the serialized payload. The supported-construct policy is explicit and closed: `$ref`, `allOf`, `patternProperties`, conditionals, a schema-valued `additionalProperties` and any unknown keyword make the tool unavailable rather than silently permissive. A remote `pattern` is only run under length bounds. The same subset drives the model-facing zod schema, so the model is not shown a looser contract than the one enforced; a schema outside the subset keeps the previous permissive conversion, which is what the first-party workspace MCP catalogue still uses.
- Dispatch rechecks. Before opening a session the call site re-resolves the current policy for its use and refuses when the connector was disabled, unassigned, re-discovered with a changed contract, or set to never since the turn was assembled.
- A proposal records the use it was made under and the connector policy version at that moment. Approval re-resolves THAT use, read from the row rather than from the approver, and refuses with `ASSISTANT_ACTION_POLICY_CHANGED` when the use now says never or the contract is unreviewed. A customer-origin request therefore keeps customer scope through human approval.
- Policy writes carry the version they were edited from and are refused when it has moved (`CONNECTOR_POLICY_CONFLICT`); a write with no base version at all is refused too. The submitted map is a patch, so a client that sends one column cannot reset the other by omission. The editor keeps its draft when a write is refused.
- The Connections page shows one column per use with the group default above it and a reset to that default in the same control, a review banner naming what moved with a Mark reviewed action, an unavailable row for a tool whose input schema cannot be enforced, and a Needs review marker on the connections list. `reviewConnectorToolsFn` is new and gates on `assistant.manage`, like every other connector write; the authorization matrix and migration contract documents are regenerated.
- The effective snapshot records each connector's policy version, catalog revision and a hash over its per-use policies and reviewed contracts, so a run stays explainable after somebody edits permissions.

Validation, all against `quackback_quinn_validation`: 78 connector tests in `connectors/__tests__`, including 32 on real PostgreSQL in `connector-policy.db.test.ts` covering the 3x3 customer/teammate matrix, the lazy projection, missing-record denial, the review gate, stale-version conflicts, approval re-resolution and the dispatch recheck. The whole affected area passes with no failures: 830 assistant tests (17 skipped, all live-model), 1,769 conversation/workflows/jobs (32 skipped, 1 todo), 2,084 functions/policy/shared-assistant, 631 admin-automation and conversation component tests, and 328 packages/db tests. Each gate was checked by disabling it and confirming the matching cases fail: a cross-use fallback in the resolver fails 3, forcing `reviewed` true fails 4, dropping the schema-change comparison fails 2, and dropping the version or the draft in the editor fails 2. The schema converter was proven red first: the two cases asserting the model-facing contract carried the enum, the integer bound, the nested object and the array items failed against the old converter while the 22 new validator cases passed. Application and workspace typechecks pass, the fresh-database drift check reports no drift, the production build succeeds and the server-function manifest has 826 entries and 826 call sites.

Effective gates: per-use resolution, the review gate and exact validation are on for every connector, with no selector. There is no flag to restore the shared map. Existing connectors keep working because their tools are grandfathered and their policies are projected into the uses they were already assigned to; a connector added after this step starts with every tool unreviewed, so the setup flow is connect, discover, review, then use. A tool whose input schema this workspace cannot enforce becomes unavailable even though it was callable before, which is the intended direction and is reported on the page with the reason.

Rollback: revert the code. The columns are additive and can stay; old code ignores them and resolves the shared `tool_policies` map again, which means reverting is not a policy-preserving rollback for a workspace that has since set different customer and teammate policies, because the shared map is the pre-Step-4 value. Nothing rewrites history, and pending proposals keep their recorded origin use.

Remaining in this area, deliberately: customer subject binding for external reads is NOT implemented, so a workspace credential is still broader than one customer's rights. The specification's own default for a reviewed account-scoped external read depends on that binding; this step ships the policy structure that can express it and leaves the enforcement to the adapter work, so a customer-facing external read remains an operator decision rather than something the product claims to scope. The workspace use has policy records and resolution but no editor on this page; it is edited through the linked surface's own settings. `policy-dial.tsx` is no longer rendered by the connector page, which now uses the shared select, and its own test still covers it. Replayable receipts and queued approvals for these tools are Step 5.

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

- P1–P2: durable intents/snapshots, transactional intake, publication and takeover fencing, independent-connection concurrency tests.
- Connection gate: independent policies per use, reviewed catalog contracts and full input validation.
- P3–P4: replayable receipts, uncertain-effect reconciliation, queued approvals, workflow delegation/recovery.
- Feedback gate: internal post audience/provenance and every public reader/side-effect boundary before automatic capture.
- Guidance gate: lossless canonical entries and atomic role bindings before shared authoring.
- P5–P6: passage indexing and evidence/answer validation.
- P7–P8: exact-candidate evaluation/publication, rollback, run inspection and operations.
- P9: channel-specific eligibility and richer procedures/follow-up.

No publish/test controls, autonomous email, automatic internal feedback capture, or write-capable retries are enabled by these changes. No push, merge or deployment is authorized by the specification.

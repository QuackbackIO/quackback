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

## Outstanding acceptance gates

- UX0: unified shell/Guidance/Deploy, enforced per-source use controls, channel inactivity relocation.
- P1–P2: durable intents/snapshots, transactional intake, publication and takeover fencing, independent-connection concurrency tests.
- Connection gate: independent policies per use, reviewed catalog contracts and full input validation.
- P3–P4: replayable receipts, uncertain-effect reconciliation, queued approvals, workflow delegation/recovery.
- Feedback gate: internal post audience/provenance and every public reader/side-effect boundary before automatic capture.
- Guidance gate: lossless canonical entries and atomic role bindings before shared authoring.
- P5–P6: passage indexing and evidence/answer validation.
- P7–P8: exact-candidate evaluation/publication, rollback, run inspection and operations.
- P9: channel-specific eligibility and richer procedures/follow-up.

No publish/test controls, autonomous email, automatic internal feedback capture, or write-capable retries are enabled by these changes. No push, merge or deployment is authorized by the specification.

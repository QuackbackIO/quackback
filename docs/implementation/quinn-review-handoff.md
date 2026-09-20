# Quinn review corrections

Branch: `feat/quinn-product`. Worktree: `/home/james/quackback/.worktrees/quinn-product`.
No push, merge or deployment is authorized or performed.

## Authorization baseline (2.1)

All seven named entry points now require `conversation.view` on a dashboard session before checking the actual parent. The request called these six functions but named seven. Reconciliation resolves ticket parents through the receipt's proposal, and refuses missing or workspace parents. Autonomous receipts still authorize their conversation. Permissionless write contracts now require `conversation.reply`; there is no separate connector management permission in the catalogue.

The auth matrix distinguishes permission-or-item-owner readers from teammate permission gates. A live scanner test pins the seven Quinn functions to their declared baseline. Visitor conversation events select their public fields explicitly and blank all teammate fields, including custom attributes and translation state. The fixture satisfies the complete required ConversationDTO and injects an unknown future run field to prove it cannot pass through.

Evidence: real `requireAuth` with portal-scoped sessions and an owned conversation failed 18 cases before the fix; the payload and empty write-permission regressions failed separately; the seven scanner assertions were red. After the fix, 137 tests across ten authorization, action, inspector, realtime and permission suites passed. Red logs: `/tmp/quinn-team-gates-red.log`, `/tmp/quinn-payload-red.log`, `/tmp/quinn-matrix-red.log`. Green: `/tmp/quinn-auth-green.log`.

Rollback: reverting this slice reopens customer access to internal records and write approval. No migration or flag is involved.

## Remaining work

Continue with 2.2 fleet replay, 2.3 concurrent indexes, 2.4 durability runner, 2.5 truthful resolution, then the supplied Phase 2 findings and final gates. The original request was truncated at the approved-action continuation item; a clarification is pending. This file is an incremental handoff, not a completion claim.

# Quinn review corrections

Branch: `feat/quinn-product`. Worktree: `/home/james/quackback/.worktrees/quinn-product`.
No push, merge or deployment is authorized or performed.

## Authorization baseline (2.1)

All seven named entry points now require `conversation.view` on a dashboard session before checking the actual parent. The request called these six functions but named seven. Reconciliation resolves ticket parents through the receipt's proposal, and refuses missing or workspace parents. Autonomous receipts still authorize their conversation. Permissionless write contracts now require `conversation.reply`; there is no separate connector management permission in the catalogue.

The auth matrix distinguishes permission-or-item-owner readers from teammate permission gates. A live scanner test pins the seven Quinn functions to their declared baseline. Visitor conversation events select their public fields explicitly and blank all teammate fields, including custom attributes and translation state. The fixture satisfies the complete required ConversationDTO and injects an unknown future run field to prove it cannot pass through.

Evidence: real `requireAuth` with portal-scoped sessions and an owned conversation failed 18 cases before the fix; the payload and empty write-permission regressions failed separately; the seven scanner assertions were red. After the fix, 137 tests across ten authorization, action, inspector, realtime and permission suites passed. Red logs: `/tmp/quinn-team-gates-red.log`, `/tmp/quinn-payload-red.log`, `/tmp/quinn-matrix-red.log`. Green: `/tmp/quinn-auth-green.log`.

Rollback: reverting this slice reopens customer access to internal records and write approval. No migration or flag is involved.

## Remaining work

Continue with the supplied Phase 2 findings and final gates. The original request was truncated at the approved-action continuation item; a clarification is pending. This file is an incremental handoff, not a completion claim.

## Fleet replay and live-table indexes (2.2, 2.3)

0286's preflight now classifies as `errors`; all ten Quinn migrations classify as `safe` or `errors`. The new span regression failed on 0286 before the annotation. Replay tests: 46 passed. 0284 still requires a one-time `allowMutatingReplay` for a fleet workspace below it, documented in the status report with the classifier limitation.

All seven listed indexes (the request said six) moved from 0286/0287/0289/0290 to `CONCURRENT_INDEX_SPECS`, retaining their exact uniqueness, columns and predicates. The same list drives creation and missing-index postconditions. Invalid-index repair examines all non-constraint indexes, including unique partial indexes, before rebuilding. The drift check now runs the concurrent step before comparing.

Evidence: seven registry/lineage regressions failed first. The fresh-database migration and drift check passed. All six application/test databases migrated successfully; their 42 index OIDs, validity flags and definitions are byte-identical before and after, so existing applied indexes were untouched. Logs: `/tmp/quinn-indexes-red.log`, `/tmp/quinn-indexes-green.log`, `/tmp/quinn-indexes-drift.log`, `/tmp/quinn-indexes-before.txt`, `/tmp/quinn-indexes-after.txt`. The registry, real PostgreSQL schema-operations and replay suites pass 27 tests.

No new migration was required. Reverting the index slice restores blocking builds for new upgrades; existing indexes need no rollback.

## Required durability gate (2.4)

`test:db:quinn` runs five committed-row suites across four dedicated databases and checks each file's JSON assertion results. CI prepares these databases in a separate service and makes the required test status depend on this job. The fixture now fails a reachable stale schema with the PostgreSQL error and migration command. Nine runner/fixture tests pass; all five dedicated suites passed without skips using `--prepare`. Database names and commands are documented in the test report.

Rollback: removing the runner or CI dependency loses required durability evidence; it changes no application behavior.

## Truthful inactivity outcomes (2.5)

Durable publication and the legacy writer stamp inability as inability, so the trigger starts an unanswered period. Only an actual answer records the involvement answer timestamp. The sweep derives effective ownership from the current involvement and latest completed run within the period, using the same rule in scheduling and under the conversation lock. An old answered stamp without a real answer, or followed by inability, closes as abandoned with no resolution event. Disabling unanswered closure leaves it open without a follow-up timer.

Improve now separates substantive answered turns from Unanswered (inability and clarification), and returns no resolution-rate headline until there is at least one confirmed resolution. Historical terminal rows are not rewritten.

Evidence: three lifecycle regressions, the durable inability-publication case, and two metrics cases were red first. After correction, 32 lifecycle cases and 23 durable run cases pass, plus 32 analytics/card checks. The lifecycle regression queries the operations and performance reports over the very same real database rows it closed. Logs: `/tmp/quinn-inactivity-red.log`, `/tmp/quinn-inactivity-green.log`, `/tmp/quinn-inability-red.log`, `/tmp/quinn-inability-green.log`, `/tmp/quinn-metrics-red.log`, `/tmp/quinn-resolution-regressions.log`.

The email delivery review remains in Phase 2, including delaying the answer clock until a mailbox send is confirmed. No schema migration or historical outcome rewrite is needed for this slice.

## Source and capture privacy

Source links now enforce portal access before reading content and require Help Center availability for articles. User activity, vote readers, proxy voting, comment REST endpoints and CSV exports exclude internal captures, including their exported comments and votes. App search and suggestion fallback deliberately request board audience because their results are used in customer linking and voting flows; private boards remain available to authorized team actors.

Evidence: source-route tests failed three cases first; real database audience and comment-route tests failed ten cases first. All four suites now pass 53 tests, with board-audience positive controls. Logs: `/tmp/quinn-source-red.log`, `/tmp/quinn-privacy-red.log`, `/tmp/quinn-privacy-green.log`. CSV exports are customer feedback exports, not full database backups. No migration required.

The saved capability report supplied the truncated continuation finding: retry and approval continuation must retain email surface, and retries must not claim an agent-handback trigger. Later requirements beyond the supplied prompt remain unknown.

## Remote schema limits

Remote `pattern` is unsupported, with no regular-expression evaluation. Schema analysis and canonical fingerprinting bound depth at 32, including annotation payloads, and over-deep contracts cannot become reviewed. Closed objects recognize only own declared properties. Four new regressions failed first (including actual stack overflow under the old implementation); all 82 connector tests now pass. Logs: `/tmp/quinn-schema-red.log`, `/tmp/quinn-schema-green.log`.

The privacy slice initially exposed an incorrect ApiAuthContext field during typecheck. The follow-up commit restores its existing role-based actor shape; typecheck then passed.

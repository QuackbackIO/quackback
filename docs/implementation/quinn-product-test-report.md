# Quinn functional validation — 18 September 2026

This validates the implemented P0, UX0 and active-involvement prerequisite on `feat/quinn-product`, against specification revision 4. It does **not** certify the entire specification: the outstanding gates in [the implementation status](quinn-product-status.md#outstanding-acceptance-gates) remain unimplemented.

## Results

| Check                                                               | Result                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Chromium acceptance against the development server                  | 21 product scenarios passed, plus authentication setup and cleanup: 23 passed, none skipped |
| Chromium acceptance against the compiled production server          | The same 21 product scenarios plus setup and cleanup: 23 passed, none skipped               |
| Full repository Vitest regression                                   | 15,634 passed; 13 failed; 34 skipped; 1 todo. 1,499 files passed, 4 failed, 4 skipped       |
| Opt-in PostgreSQL conversation lifecycle suite                      | 28 passed, none skipped; run separately with a migrated lifecycle database                  |
| Updated navigation/schema/authorization/migration regression checks | 121 passed                                                                                  |
| Application and workspace-probe typechecks                          | Passed                                                                                      |
| Dedicated browser-suite typecheck and changed-file lint             | Passed                                                                                      |
| Production build                                                    | Passed                                                                                      |
| Production server-function manifest                                 | Passed: 823 entries and 823 bundle call sites                                               |
| Live local-model runtime                                            | 2 failed; vision test skipped without an image fixture                                      |

The full regression run is still red. The 13 remaining failures were reproduced in an independently installed checkout of the pre-Quinn commit `9a10dd86ff364ca4a3cad0d0dc8252314ce33855`:

| Existing failure                     | Count | Evidence                                                                                                                                                       |
| ------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fleet migration gap-healing fixtures | 7     | The fixtures require a replay-safe suffix with a hole, mark and tail. Migration 0284 already collapses that window. The conservative replay gate was retained. |
| Job handler import checks            | 2     | Two inactivity queues share one handler module; snooze-sweep has a call-time import.                                                                           |
| Job registry documentation           | 3     | JOBS.md omits the two inactivity queues.                                                                                                                       |
| Side-effect ledger inventory         | 1     | `assistant_involvements.follow_up_sent_at` is unclassified.                                                                                                    |

The baseline also failed its stale migration-tail assertion; this branch's expected tail now includes 0284–0286. Authorization and migration inventory updates were generated and reviewed: two gated server functions, one intentionally public citation route with current visibility checks, two additive migrations, and no additional destructive DDL.

## Functional coverage

The durable browser suite is [quinn-product.spec.ts](../../apps/web/e2e/tests/admin/quinn-product.spec.ts). It drives the actual application, server functions and PostgreSQL, with no mocked browser responses.

| Area                | Exercised behavior                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Navigation          | Six Quinn pages; eight Agent/Copilot tab aliases and the Skills alias                                                                                                                                                                                                                |
| Guidance            | Create, edit, disable, search, delete; validation; cancel/discard; legacy instructions longer than 7,000 characters and all three assignments preserved                                                                                                                              |
| Concurrent editing  | A stale voice save is rejected, its draft retained, and the winning persisted value preserved                                                                                                                                                                                        |
| Source types        | Every supported customer/teammate master switch persists independently; unsupported private customer types remain disabled; a type master caps access without overwriting row preferences                                                                                            |
| Documents           | Independent per-use switches, reload persistence, PDF and Word upload, real extraction, citation reads, removal, malformed content and oversize rejection                                                                                                                            |
| Web pages           | Real HTTPS fetch from example.com, persistence, per-use switches, disabled-source re-enablement, removal and private-network URL rejection                                                                                                                                           |
| Help Center         | Article exclusion save/reload, Excluded from Quinn filter, independent teammate use, current public citation access                                                                                                                                                                  |
| Citation revocation | Excluded, private-category, segmented-category, deleted and malformed sources become unavailable; successful reads use `Cache-Control: no-store`                                                                                                                                     |
| Channel settings    | Independent Messenger/Email clocks; parent edits retain the disabled Quinn draft; cancel restores it; Built-in/Custom/Off ownership persists and controls visibility                                                                                                                 |
| Deployment          | Cancel and confirm automatic-reply changes; persistence; teammate capability remains unchanged                                                                                                                                                                                       |
| Authorization       | Anonymous route and mutation denial; a custom role with `help_center.manage` and the shell's `member.view` can edit article use but cannot open Quinn management or replay its source mutation. Replays use an opposite database value so an unauthorized write would be observable. |
| Responsive behavior | Knowledge and Guidance editor at 390px; no horizontal overflow or browser exceptions                                                                                                                                                                                                 |
| Backend correctness | Full regression includes citation kinds, validated customer output, tool failure/idempotency receipts, retrieval exclusions and independent-connection active-involvement concurrency tests                                                                                          |
| Lifecycle           | Separate real-PostgreSQL suite covers ownership initialization, message anchors, contact capture, follow-up/closure, delivery/retries and concurrency                                                                                                                                |

## Regressions fixed during testing

1. Help Center could refuse to save a populated article because a wrapped editor callback lost its function arity and received empty Markdown. The form now explicitly requests Markdown emission. The browser suite saves an existing populated article while changing its Quinn exclusion and verifies the retained content and persisted exclusion.
2. Add page used a button that defaulted to `type="button"`, so clicking it did not submit the URL form. It now explicitly submits. Both successful public ingestion and SSRF rejection are exercised through that button.

The updated sidebar/tab/schema assertions reflect the new Quinn navigation, Ask Quinn label and two source-use columns. No assertions were removed to suppress a product failure.

## Limits and remaining acceptance gates

- The real local endpoint was Ollama's `gemma4:12b-it-q4_K_M`. One current-branch test timed out at 60 seconds; another returned `openai-compatible.structuredOutputStream: response contained no content`. Both live tests also failed with no structured content on the pre-Quinn commit. This is an unresolved runtime/provider compatibility result, not a passing customer-answer test.
- No complete real-provider widget conversation, live external connector write, Slack/email delivery, image answer or cross-browser matrix is certified. The local application has no configured delivery provider. PDF/Word ingestion was tested without object storage or embeddings configured; successful vector generation and original-file storage were not part of those browser runs.
- The full suite's skipped tests and todo are not passes. The 28 lifecycle tests were subsequently run separately; vision remains untested. This report measures functional scenarios, not a 100% line/branch coverage metric.
- Durable intents/snapshots, takeover/publication fencing, per-use connector policies, approval queues, uncertain-effect reconciliation, internal feedback privacy, canonical Guidance bindings, passage indexing, exact-candidate evaluation/publication, run inspection and later channel procedures still require their implementation and acceptance gates. Current citation revocation does not certify in-flight answer revocation.
- Production publication remains blocked by these outstanding gates and red checks. Testing used isolated local databases; nothing was pushed, merged or deployed.

## Reproduce

Install frozen dependencies, build the widget, migrate and seed a disposable application database, and point the application at it. Use a separate empty migrated database for the full regression suite. The lifecycle database must have `lifecycle` in its name and one settings row.

```bash
# From apps/web, with the application running against this same isolated database:
PLAYWRIGHT_BASE_URL=http://localhost:3018 \
QUINN_E2E_DATABASE_URL="$QUINN_APPLICATION_DATABASE_URL" \
bunx playwright test e2e/tests/admin/quinn-product.spec.ts \
  --project=chromium --workers=1 --reporter=list

# From the repository root:
TEST_DATABASE_URL="$QUINN_REGRESSION_DATABASE_URL" bunx vitest run --maxWorkers=4
TEST_DATABASE_URL="$QUINN_LIFECYCLE_DATABASE_URL" bunx vitest run \
  apps/web/src/lib/server/domains/conversation/__tests__/conversation-inactivity.db.test.ts
bun run typecheck
bunx tsc --noEmit -p apps/web/tsconfig.quinn-e2e.check.json
bun run build
bun run --cwd apps/web check:server-fn-manifest
```

The browser suite intentionally skips without `QUINN_E2E_DATABASE_URL`. A required gate must set it and check for zero skips. Run it alone against its dedicated database: it snapshots/restores workspace settings and deletes its tagged fixtures, but other concurrent tests must not mutate the same settings. Public-page ingestion requires outbound HTTPS to example.com.

The production browser run used `BASE_URL=http://localhost:3019 PORT=3019 NITRO_PORT=3019 bun --env-file=.env apps/web/.output/server/index.mjs`, then the browser command above with port 3019. This was a local production build, not a deployment.

Local raw logs from this run: `/tmp/quinn-e2e-final.log`, `/tmp/quinn-e2e-production.log`, `/tmp/quinn-full-suite-final.log`, `/tmp/quinn-baseline-tests.log`, `/tmp/quinn-lifecycle-tests.log`, `/tmp/quinn-live-model.log`, `/tmp/quinn-baseline-live.log`, `/tmp/quinn-build-final.log` and `/tmp/quinn-manifest-final.log`.

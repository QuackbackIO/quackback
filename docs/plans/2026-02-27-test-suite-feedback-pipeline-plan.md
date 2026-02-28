# Test Suite Plan: Feedback Aggregation Pipeline

**Date:** 2026-02-27
**Branch:** `feat/feedback-aggregation`
**Framework:** Vitest (node environment), `vi.mock` for dependency isolation

## Coverage Summary

**Existing tests on branch:** 0 feedback-related test files (42 test files total, none cover this feature)

**Target:** 8 new test files covering all backend pipeline services, ingestion, event handlers, and shared utils.

---

## Test File 1: `apps/web/src/lib/shared/utils/__tests__/string.test.ts`

**Priority:** High (pure functions, zero deps, immediate value)

### `getInitials(name)`

| Test                          | Input                     | Expected |
| ----------------------------- | ------------------------- | -------- |
| multi-word name               | `'John Doe'`              | `'JD'`   |
| single word                   | `'Alice'`                 | `'A'`    |
| three+ words (truncates to 2) | `'Jean Claude Van Damme'` | `'JC'`   |
| null                          | `null`                    | `'?'`    |
| undefined                     | `undefined`               | `'?'`    |
| empty string                  | `''`                      | `'?'`    |

### `normalizeStrength(raw)`

| Test                        | Input      | Expected                    |
| --------------------------- | ---------- | --------------------------- |
| zero                        | `0`        | `0`                         |
| negative                    | `-5`       | `0`                         |
| NaN                         | `NaN`      | `0`                         |
| Infinity                    | `Infinity` | `0`                         |
| raw ~10 maps to ~8          | `10`       | `~7.9` (verify calibration) |
| raw ~1 maps to low          | `1`        | `~2.3`                      |
| very large raw clamps at 10 | `1000`     | `10`                        |

### `strengthTier(normalized)`

| Test          | Input | Expected     |
| ------------- | ----- | ------------ |
| boundary: 0   | `0`   | `'low'`      |
| boundary: 2   | `2`   | `'low'`      |
| boundary: 2.1 | `2.1` | `'medium'`   |
| boundary: 5   | `5`   | `'medium'`   |
| boundary: 5.1 | `5.1` | `'high'`     |
| boundary: 8   | `8`   | `'high'`     |
| boundary: 8.1 | `8.1` | `'critical'` |
| boundary: 10  | `10`  | `'critical'` |

### `stripHtml(html)`

| Test                  | Input                            | Expected            |
| --------------------- | -------------------------------- | ------------------- |
| tags stripped         | `'<p>Hello <b>world</b></p>'`    | `'Hello world'`     |
| entities decoded      | `'&amp; &lt; &gt; &quot; &#39;'` | `'& < > " \''`      |
| nbsp replaced         | `'foo&nbsp;bar'`                 | `'foo bar'`         |
| whitespace normalized | `'  too   many  spaces  '`       | `'too many spaces'` |
| no tags               | `'plain text'`                   | `'plain text'`      |

---

## Test File 2: `apps/web/src/lib/server/domains/feedback/pipeline/__tests__/quality-gate.test.ts`

**Priority:** High (guards every item entering the pipeline)
**Mocks:** `@/lib/server/domains/ai/config` (`getOpenAI`), `@/lib/server/domains/ai/retry` (`withRetry`), `./prompts/quality-gate.prompt`

### `shouldExtract(item)` — tiered gate logic

| Test                                     | Scenario                                                           | Expected                                                             |
| ---------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Tier 1: < 5 words                        | `{ sourceType: 'slack', content: { text: 'ok sure' } }`            | `{ extract: false, reason: /insufficient/ }`                         |
| Tier 2: high-intent + 15+ words          | `{ sourceType: 'quackback', content: { text: '20 words...' } }`    | `{ extract: true, reason: /high-intent/ }` — verify NO LLM call made |
| Tier 2: high-intent + < 15 words         | `{ sourceType: 'api', content: { text: '10 words...' } }`          | Falls through to Tier 3 (LLM called)                                 |
| Tier 3: LLM returns `{ extract: false }` | Mock LLM response `'{"extract": false, "reason": "not feedback"}'` | `{ extract: false }`                                                 |
| Tier 3: LLM returns `{ extract: true }`  | Mock LLM response                                                  | `{ extract: true }`                                                  |
| Tier 3: LLM returns empty                | Mock empty `choices[0].message.content`                            | `{ extract: true, reason: /empty/ }`                                 |
| Tier 3: LLM throws                       | Mock `withRetry` to throw                                          | `{ extract: true, reason: /error/ }` (non-blocking)                  |
| AI not configured                        | `getOpenAI()` returns null, 20 words                               | `{ extract: true, reason: /word count/ }`                            |
| AI not configured, short                 | `getOpenAI()` returns null, 10 words                               | `{ extract: false, reason: /word count/ }`                           |
| Code fences stripped                     | LLM returns ` ```json\n{"extract":true}\n``` `                     | `{ extract: true }`                                                  |

---

## Test File 3: `apps/web/src/lib/server/domains/feedback/pipeline/__tests__/clustering.test.ts`

**Priority:** High (core clustering logic + strength calculation)
**Mocks:** `@/lib/server/db`, `../queues/feedback-ai-queue`, `@quackback/ids`

### `assignSignalToTheme` — branching logic

| Test                                               | Scenario                                  | Expected                                                           |
| -------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| assign_existing: valid ID, active theme            | Theme found with `status: 'under_review'` | Signal updated with themeId, centroid updated, auto-link attempted |
| assign_existing: invalid TypeID, has newTheme      | `themeId: 'truncated_id'`                 | Falls back to `createNewTheme`                                     |
| assign_existing: invalid TypeID, no newTheme       | No fallback                               | Returns early (signal skipped)                                     |
| assign_existing: theme not found, has newTheme     | DB returns null                           | Falls back to `createNewTheme`                                     |
| assign_existing: theme archived (status='shipped') | Status not in ACTIVE_STATUSES             | Falls back to `createNewTheme`                                     |
| create_new                                         | `action: 'create_new'`                    | Calls `createNewTheme`, assigns signal                             |
| neither action                                     | `action: 'skip'`                          | Returns early                                                      |
| signal dedup: near-identical exists                | `isSignalDuplicate` returns true          | Signal NOT assigned (no DB update)                                 |

### `recomputeThemeStats` — strength calculation

| Test                              | Scenario                                   | Expected                                    |
| --------------------------------- | ------------------------------------------ | ------------------------------------------- |
| zero signals                      | Theme exists, no signals                   | All stats reset to 0/null                   |
| theme not found                   | Non-existent themeId                       | Returns early (no error)                    |
| single signal, single author      | 1 signal, confidence 0.8 \* 0.7            | `strength = 0.56 * recencyFactor`           |
| per-author diminishing returns    | 3 signals same author (conf 0.9, 0.8, 0.7) | `0.9*0.7/1 + 0.8*0.5/2 + 0.7*0.3/4` pattern |
| anonymous signals get full weight | 2 signals, no principalId                  | Each gets weight at i=0 (no diminishing)    |
| recency factor: fresh theme       | lastSignalAt = now                         | `recencyFactor ≈ 1.0`                       |
| recency factor: 30-day old theme  | lastSignalAt = 30 days ago                 | `recencyFactor = 0.1` (clamped floor)       |
| sentiment/urgency distribution    | Mixed signals                              | Correct counts per value                    |
| board majority vote               | 3 signals: 2 board A, 1 board B            | `boardId = A`                               |

### Fuzzy title dedup helpers (test via `createNewTheme` mock internals or extract)

| Test                            | Scenario                      | Expected                            |
| ------------------------------- | ----------------------------- | ----------------------------------- |
| stemWord: 'notifications'       |                               | `'notif'` (strips -ation, -s)       |
| stemWord: 'improving'           |                               | `'improv'` (strips -ing)            |
| stemWord: short word 'go'       |                               | `'go'` (unchanged, < 3 chars guard) |
| jaccard: identical sets         | `{a, b, c}` vs `{a, b, c}`    | `1.0`                               |
| jaccard: disjoint sets          | `{a, b}` vs `{c, d}`          | `0.0`                               |
| jaccard: partial overlap        | `{a, b, c}` vs `{b, c, d}`    | `0.5`                               |
| jaccard: empty sets             | `{}` vs `{}`                  | `0` (union=0 guard)                 |
| titleWords: stop words filtered | `'the notification settings'` | Set without 'the'                   |

> **Note:** The fuzzy helpers (`stemWord`, `titleWords`, `jaccard`) are currently private closures inside `findExistingThemeByFuzzyTitle`. To test them, we should extract them as named module-level functions (still unexported) or export them under a `__test__` namespace. The test file can import from the module's internal scope using Vitest's module mock to intercept calls, OR we simply refactor to export them.

---

## Test File 4: `apps/web/src/lib/server/domains/feedback/ingestion/__tests__/author-resolver.test.ts`

**Priority:** High (runs on every feedback item, bugs corrupt user records)
**Mocks:** `@/lib/server/db`, `@quackback/ids` (`createId`)

### `resolveAuthorPrincipal(author, sourceType)`

| Test                             | Scenario                                    | Expected                                           |
| -------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| principalId already set          | `{ principalId: 'p_123' }`                  | Returns `'p_123'` directly, no DB calls            |
| email: existing user found       | DB select returns match                     | Returns existing principalId, no insert            |
| email: new user                  | DB select returns empty                     | Creates user + principal, returns new principalId  |
| email: normalized                | `{ email: '  Alice@Example.COM  ' }`        | Queries with `'alice@example.com'`                 |
| email: empty after trim          | `{ email: '   ' }`                          | Falls through to externalUserId path               |
| externalUserId: existing mapping | DB findFirst returns match                  | Returns mapped principalId                         |
| externalUserId: new, no email    | No mapping found                            | Creates user (synthetic email), principal, mapping |
| externalUserId: new, with email  | No mapping, email provided                  | Resolves by email first, then creates mapping      |
| externalUserId: display name     | `{ externalUserId: 'U123', name: 'Alice' }` | User created with name `'Alice'`                   |
| externalUserId: no name          | `{ externalUserId: 'U123' }`                | Display name = `'slack:U123'`                      |
| no identifiers                   | `{}`                                        | Returns `null`                                     |

---

## Test File 5: `apps/web/src/lib/server/domains/feedback/ingestion/__tests__/feedback-ingest.test.ts`

**Priority:** High (entry point for all feedback)
**Mocks:** `@/lib/server/db`, `../queues/feedback-ingest-queue`, `../queues/feedback-ai-queue`, `./author-resolver`, `@/lib/server/domains/ai/config`

### `ingestRawFeedback(seed, context)`

| Test             | Scenario                                     | Expected                                                              |
| ---------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| new item         | No existing match                            | Inserts, enqueues `enrich-context`, returns `{ deduplicated: false }` |
| duplicate        | Existing match by `(sourceId, dedupeKey)`    | Returns `{ deduplicated: true }`, no insert                           |
| dedupeKey format | `sourceType: 'slack', externalId: 'msg_123'` | Key = `'slack:msg_123'`                                               |

### `enrichAndAdvance(rawItemId)`

| Test            | Scenario                      | Expected                                                      |
| --------------- | ----------------------------- | ------------------------------------------------------------- |
| item not found  | DB returns null               | Warns, returns (no error)                                     |
| AI enabled      | `isAIEnabled()` returns true  | Updates to `ready_for_extraction`, enqueues `extract-signals` |
| AI disabled     | `isAIEnabled()` returns false | Updates to `completed` directly                               |
| author resolved | Author has email              | `resolveAuthorPrincipal` called, principalId set on item      |

---

## Test File 6: `apps/web/src/lib/server/domains/feedback/pipeline/__tests__/stuck-recovery.test.ts`

**Priority:** Medium (maintenance service, important for reliability)
**Mocks:** `@/lib/server/db`, `../queues/feedback-ai-queue`

### `recoverStuckItems()`

| Test                          | Scenario                              | Expected                                        |
| ----------------------------- | ------------------------------------- | ----------------------------------------------- |
| no stuck items                | DB returns empty arrays               | No updates, no enqueues                         |
| stuck raw item, < 3 attempts  | `attemptCount: 1`, stuck 31min        | Resets to `ready_for_extraction`, re-enqueues   |
| stuck raw item, >= 3 attempts | `attemptCount: 3`, stuck 31min        | Marks `failed` with error message               |
| stuck signal                  | Signal in `interpreting` state, stale | Resets to `pending_interpretation`, re-enqueues |
| mix of items and signals      | Both stuck raw items and signals      | All recovered appropriately                     |

---

## Test File 7: `apps/web/src/lib/server/events/handlers/__tests__/feedback-pipeline.test.ts`

**Priority:** Medium (event handler, bridges posts to pipeline)
**Mocks:** `@/lib/server/db`, `@/lib/server/domains/comments/comment.service`, `@/lib/server/domains/feedback/ingestion/feedback-ingest.service`

### `collectCustomerMessages(threads)` — pure function

| Test                     | Scenario                                 | Expected                            |
| ------------------------ | ---------------------------------------- | ----------------------------------- |
| team member filtered     | `[{ isTeamMember: true, ... }]`          | Empty array                         |
| customer included        | `[{ isTeamMember: false, ... }]`         | One message with `role: 'customer'` |
| nested replies           | Customer reply inside team member thread | Reply included, parent excluded     |
| Date vs string createdAt | `createdAt: new Date(...)`               | ISO string in output                |
| empty replies array      | `replies: []`                            | No error, no extra messages         |

### `feedbackPipelineHook.run(event)` — orchestration

| Test                        | Scenario                                | Expected                                    |
| --------------------------- | --------------------------------------- | ------------------------------------------- |
| non post.created event      | `event.type: 'post.voted'`              | Returns `{ success: true }` immediately     |
| post already linked to idea | `ideaPostLinks.findFirst` returns match | Returns `{ success: true }`, no ingestion   |
| no quackback source         | `getQuackbackSourceId` returns null     | Returns `{ success: true }`, no ingestion   |
| happy path                  | Source found, no link                   | Calls `ingestRawFeedback` with correct seed |
| comments fail               | `getCommentsByPost` throws              | Still ingests (empty thread context)        |

### `resetQuackbackSourceCache()`

| Test         | Scenario                    | Expected                              |
| ------------ | --------------------------- | ------------------------------------- |
| resets cache | Call reset, then hook fires | Re-queries DB for source (not cached) |

---

## Test File 8: `apps/web/src/lib/server/domains/feedback/pipeline/__tests__/signal-trends.test.ts`

**Priority:** Medium (ISO week boundary math is tricky)
**Approach:** Extract date boundary calculation into a testable pure function

### ISO week boundary calculation

| Test          | Scenario           | Expected                                                 |
| ------------- | ------------------ | -------------------------------------------------------- |
| Monday        | `2026-02-23` (Mon) | `thisWeekStart = 2026-02-23T00:00:00Z`                   |
| Wednesday     | `2026-02-25` (Wed) | `thisWeekStart = 2026-02-23T00:00:00Z`                   |
| Sunday        | `2026-02-22` (Sun) | `thisWeekStart = 2026-02-16T00:00:00Z` (previous Monday) |
| Saturday      | `2026-02-28` (Sat) | `thisWeekStart = 2026-02-23T00:00:00Z`                   |
| lastWeekStart | Any day            | `thisWeekStart - 7 days`                                 |

> **Note:** The date math is embedded in `computeSignalTrends()` which does DB writes. Recommend extracting `getISOWeekBoundaries(date: Date): { thisWeekStart: Date; lastWeekStart: Date }` as a pure helper to test the boundary logic without DB mocking.

---

## Refactoring Notes

To maximize testability with minimal code changes:

1. **Extract `stemWord`, `titleWords`, `jaccard`** from the closure in `findExistingThemeByFuzzyTitle` → export as `_testHelpers` or move to a `clustering-utils.ts` file.

2. **Extract `getISOWeekBoundaries`** from `computeSignalTrends` → pure function in `signal-trends.service.ts`, exported for testing.

3. **Extract `stripCodeFences`** — currently duplicated in 4 files (quality-gate, summary-regen, reclassification, extraction). Move to a shared `pipeline-utils.ts` and test once.

4. **Extract `wordCount`** from quality-gate — small but used in gate logic, worth testing via the module.

5. **Extract `mode`** from summary-regen — pure utility, test directly.

6. **Extract `truncateSummary`** from taxonomy-snapshot — pure function, test directly.

---

## Implementation Order

1. **String utils** — 0 deps, fastest to write, immediate coverage
2. **Quality gate** — guards every item, well-defined tiers
3. **Author resolver** — critical correctness, every ingestion depends on it
4. **Feedback ingest** — entry point for all feedback, dedup logic
5. **Clustering** — complex branching + strength math (may need small refactor for fuzzy helpers)
6. **Stuck recovery** — straightforward mock + assert pattern
7. **Feedback pipeline hook** — event handler with `collectCustomerMessages` pure function
8. **Signal trends** — extract date math helper, test boundaries

**Estimated total:** ~150-200 test cases across 8 files.

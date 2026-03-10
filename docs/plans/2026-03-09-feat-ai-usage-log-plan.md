# Plan: AI Usage Log + Pipeline Audit Log

Two complementary logging systems:

1. **AI Usage Log** - token costs, model usage, and timing per API call (cost analysis)
2. **Pipeline Audit Log** - processing decisions, inputs/outputs, and state transitions per feedback item (operational observability)

This document is the implementation plan for **data capture only**. The admin analytics UI/product surface has been extracted into a separate follow-on plan: [`2026-03-09-feat-admin-analytics-plan.md`](./2026-03-09-feat-admin-analytics-plan.md).

## Problem

The feedback pipeline makes up to 5 AI calls per item but only 1 saves token data. Processing decisions (quality gate rejections, dedup skips, vote-vs-create thresholds, admin edits at accept time) are logged to console and discarded. There's no way to analyze costs, audit what was processed, understand why items were rejected, or debug pipeline failures.

## Terminology

- `ai_signals` was the old post-level AI insights feature. It was removed on March 6, 2026 and is out of scope for this plan.
- `feedback_signals` is the current raw-feedback pipeline table. In this document, any reference to "signals" means `feedback_signals` unless explicitly stated otherwise.
- This plan adds logging around the existing feedback pipeline; it does not reintroduce the removed `ai_signals` subsystem.

---

# Part 1: AI Usage Log

## Design

### New table: `ai_usage_log`

One row per API call. Append-only cost ledger.

```sql
CREATE TABLE ai_usage_log (
  id              uuid PRIMARY KEY,
  pipeline_step   varchar(30) NOT NULL,   -- see enum below
  call_type       varchar(20) NOT NULL,   -- 'chat_completion' | 'embedding'
  model           varchar(100) NOT NULL,  -- exact model identifier used

  -- Domain references (plain UUIDs, NO foreign keys - append-only ledger)
  raw_feedback_item_id  uuid,
  signal_id             uuid,               -- references feedback_signals.id
  post_id               uuid,

  -- Token usage
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer,               -- null for embeddings
  total_tokens    integer NOT NULL DEFAULT 0,

  -- Timing & retries
  duration_ms     integer NOT NULL,
  retry_count     integer NOT NULL DEFAULT 0,

  -- Outcome
  status          varchar(10) NOT NULL DEFAULT 'success',  -- 'success' | 'error'
  error           text,

  -- Extensible context
  metadata        jsonb,                  -- prompt version, temperature, max_tokens, etc.

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_log_step_idx ON ai_usage_log (pipeline_step);
CREATE INDEX ai_usage_log_created_idx ON ai_usage_log (created_at);
CREATE INDEX ai_usage_log_raw_item_idx ON ai_usage_log (raw_feedback_item_id);
```

Domain ID columns are plain UUIDs with no FK constraints - enables per-item cost attribution without coupling the ledger to domain tables. No CASCADE, no dependency.

### Pipeline steps enum

| `pipeline_step`    | `call_type`       | Source file                     | IDs populated                       |
| ------------------ | ----------------- | ------------------------------- | ----------------------------------- |
| `quality_gate`     | `chat_completion` | quality-gate.service.ts         | `raw_feedback_item_id`              |
| `extraction`       | `chat_completion` | extraction.service.ts           | `raw_feedback_item_id`              |
| `suggestion`       | `chat_completion` | interpretation.service.ts       | `raw_feedback_item_id`, `signal_id` |
| `signal_embedding` | `embedding`       | pipeline/embedding.service.ts   | `raw_feedback_item_id`, `signal_id` |
| `post_embedding`   | `embedding`       | embeddings/embedding.service.ts | `post_id`                           |
| `sentiment`        | `chat_completion` | sentiment.service.ts            | `post_id`                           |

### TypeID prefix

Add `ai_usage` to `packages/ids/src/prefixes.ts` with prefix `ailog`.

## Implementation

### Step 1: Schema + migration

**New file:** `packages/db/drizzle/0030_ai_usage_and_pipeline_log.sql`
**New file:** `packages/db/src/schema/ai-usage-log.ts` with Drizzle table definition.
**Edit:** `packages/db/src/schema/index.ts` - export new table.
**Edit:** `packages/ids/src/prefixes.ts` - add `ai_usage: 'ailog'` prefix.
**Edit:** `packages/ids/src/types.ts` - add `AiUsageLogId` type alias.

### Step 2: Logging helpers

**New file:** `apps/web/src/lib/server/domains/ai/usage-log.ts`

```ts
interface LogAiUsageParams {
  pipelineStep: string
  callType: 'chat_completion' | 'embedding'
  model: string
  rawFeedbackItemId?: string
  signalId?: string
  postId?: string
  inputTokens: number
  outputTokens?: number
  totalTokens: number
  durationMs: number
  retryCount?: number
  status?: 'success' | 'error'
  error?: string
  metadata?: Record<string, unknown>
}

export async function logAiUsage(params: LogAiUsageParams): Promise<void>
```

`ai_usage_log` is canonical for the AI calls covered by this plan, so call sites should `await` logging. Failure policy depends on the execution context:

- **Pipeline jobs** (quality gate, extraction, interpretation, signal embedding): let logging failures bubble — BullMQ retries are cheap and the audit trail stays consistent.
- **Request/cron paths** (sentiment, post embedding): `await` but catch and log a warning (`console.warn`) rather than failing the primary operation. A temporarily unavailable usage ledger should not block user-facing work or cron runs.

Also export a timing/retry wrapper:

```ts
export async function withUsageLogging<T>(
  params: Omit<
    LogAiUsageParams,
    | 'durationMs'
    | 'inputTokens'
    | 'outputTokens'
    | 'totalTokens'
    | 'status'
    | 'error'
    | 'retryCount'
  >,
  fn: () => Promise<{ result: T; retryCount: number }>,
  extractUsage: (result: T) => { inputTokens: number; outputTokens?: number; totalTokens: number }
): Promise<T>
```

`withUsageLogging` wraps `withRetry` — not the raw API call. This produces one ledger row per logical call, capturing the final retry count and total wall-clock time (including retries). On final error, it still inserts an `ai_usage_log` row with `status: 'error'`, `retryCount` reflecting how many retries were exhausted, and then rethrows. Call sites replace their existing `withRetry(...)` with `withUsageLogging({ ... }, () => withRetry(...), extractUsage)`.

**Edit** `apps/web/src/lib/server/domains/ai/retry.ts`: modify `withRetry` to return `{ result: T, retryCount: number }` instead of just `T`.

We are intentionally modifying the existing helper contract here rather than adding a second retry abstraction. The current call surface is small and server-only, so this is a controlled, mechanical update:

- `summary.service.ts`
- `sentiment.service.ts`
- `embeddings/embedding.service.ts`
- `merge-assessment.service.ts`
- `interpretation.service.ts`
- `pipeline/embedding.service.ts`
- `quality-gate.service.ts`
- `extraction.service.ts`

Update the affected tests/mocks alongside those call sites so they expect `{ result, retryCount }` instead of a bare completion/response value. All 5 test files use an identical `vi.fn((fn) => fn())` mock pattern — change to `vi.fn((fn) => fn().then(result => ({ result, retryCount: 0 })))`:

- `pipeline/__tests__/quality-gate.service.test.ts`
- `pipeline/__tests__/extraction.service.test.ts`
- `pipeline/__tests__/interpretation.service.test.ts`
- `pipeline/__tests__/embedding.service.test.ts`
- `merge-suggestions/__tests__/merge-assessment.service.test.ts`

The backfill scripts (`backfill-merge-suggestions.ts`, `backfill-ai.ts`) define local `withRetry` copies and are unaffected.

For embeddings, keep the shared abstraction flat: extend `generateEmbedding()` to accept an optional usage-log context rather than introducing a second `generateEmbeddingWithUsage()` helper.

### Step 3: Instrument quality gate (quality-gate.service.ts)

**Current:** `shouldExtract()` receives `{ sourceType, content, context }` - no `rawFeedbackItemId`.

**Changes:**

- Add optional `rawFeedbackItemId?: string` to the function parameter.
- Thread `rawFeedbackItemId` from caller in `extractSignals()` (extraction.service.ts line 60).
- Wrap the LLM call with `withUsageLogging()`:
  - `pipelineStep: 'quality_gate'`
  - `model: QUALITY_GATE_MODEL`
  - `rawFeedbackItemId`
  - `metadata: { promptVersion: 'v1', isChannelMonitor, temperature: 0 }`

### Step 4: Instrument extraction (extraction.service.ts)

**Current:** Already saves tokens to `raw_feedback_items`. Keep that for backward compat.

**Changes:**

- Wrap the extraction LLM call with `withUsageLogging()`:
  - `pipelineStep: 'extraction'`
  - `model: EXTRACTION_MODEL`
  - `rawFeedbackItemId: rawItemId`
  - `metadata: { promptVersion: EXTRACTION_PROMPT_VERSION }`

### Step 5: Instrument suggestion generation (interpretation.service.ts)

**Current:** `completion.usage` is never read. `feedbackSignals.inputTokens`/`outputTokens` columns exist but are dead.

**Changes:**

- Remove the `as any` cast on `completion`.
- Wrap the LLM call with `withUsageLogging()`:
  - `pipelineStep: 'suggestion'`
  - `model: SUGGESTION_MODEL`
  - `rawFeedbackItemId: opts.rawFeedbackItemId`
  - `signalId: opts.signalId`
  - `metadata: { suggestionType: opts.type }`
- Optionally populate `feedback_signals.input_tokens`/`output_tokens` since the columns exist.

### Step 6: Instrument signal embedding (pipeline/embedding.service.ts)

**Changes:**

- Add optional `rawFeedbackItemId?: string` parameter to `embedSignal()`. The caller in `interpretation.service.ts` already has `signal.rawFeedbackItemId` in scope and threads it through.
- Refactor `embedSignal()` to use the shared `generateEmbedding(text, opts?)` helper instead of calling `openai.embeddings.create()` directly.
- Pass optional usage-log context:
  - `pipelineStep: 'signal_embedding'`
  - `model: EMBEDDING_MODEL`
  - `rawFeedbackItemId`
  - `signalId`
  - Embedding API returns `response.usage.prompt_tokens` and `response.usage.total_tokens` (no `output_tokens`).

### Step 7: Instrument post embedding (embeddings/embedding.service.ts)

**Current:** `generateEmbedding()` only receives `text: string` and returns `number[] | null`.

**Changes:**

- Modify `generateEmbedding()` in place to accept optional usage-log context while keeping its `Promise<number[] | null>` return type unchanged.
- `generatePostEmbedding()` passes usage-log context:
  - `pipelineStep: 'post_embedding'`
  - `model: EMBEDDING_MODEL`
  - `postId`
- Non-logging callers (`public-posts.ts`, app suggest API, similarity helpers) can continue calling `generateEmbedding(text)` unchanged.

### Step 8: Instrument sentiment (sentiment.service.ts)

**Current:** Already saves tokens to `post_sentiment`. Keep that.

**Changes:**

- Wrap the LLM call with `withUsageLogging()`:
  - `pipelineStep: 'sentiment'`
  - `model: SENTIMENT_MODEL` (extract `'google/gemini-3.1-flash-lite-preview'` to a `const SENTIMENT_MODEL` — it appears twice inline: in the API call and in the returned result)
  - `postId` (thread from caller)

## Existing token columns

**Keep as-is** - they're already populated and may be queried. `ai_usage_log` becomes the canonical source for the AI flows instrumented in this plan, while the scattered columns remain for convenience/backward compat. No migration to remove them.

## AI usage queries

```sql
-- Total tokens by day and model
SELECT date_trunc('day', created_at) AS day, model,
       SUM(input_tokens) AS input, SUM(output_tokens) AS output
FROM ai_usage_log WHERE status = 'success'
GROUP BY 1, 2 ORDER BY 1 DESC;

-- Cost breakdown by pipeline step
SELECT pipeline_step, COUNT(*) AS calls,
       SUM(input_tokens) AS input, SUM(output_tokens) AS output
FROM ai_usage_log GROUP BY 1;

-- Cost per feedback item (total tokens across all steps)
SELECT raw_feedback_item_id,
       SUM(input_tokens) AS input, SUM(output_tokens) AS output,
       SUM(duration_ms) AS total_ms, COUNT(*) AS api_calls
FROM ai_usage_log
WHERE raw_feedback_item_id IS NOT NULL
GROUP BY 1 ORDER BY input DESC;

-- Cost per raw item that led to an accepted suggestion (the "useful cost" metric)
WITH accepted_items AS (
  SELECT DISTINCT raw_feedback_item_id
  FROM feedback_suggestions
  WHERE status = 'accepted'
)
SELECT AVG(total_input) AS avg_input_per_accepted_item,
       AVG(total_output) AS avg_output_per_accepted_item
FROM (
  SELECT a.raw_feedback_item_id,
         SUM(a.input_tokens) AS total_input,
         SUM(COALESCE(a.output_tokens, 0)) AS total_output
  FROM ai_usage_log a
  JOIN accepted_items ai ON ai.raw_feedback_item_id = a.raw_feedback_item_id
  GROUP BY a.raw_feedback_item_id
) sub;

-- Wasted spend on quality-gate-rejected items
SELECT COUNT(*) AS rejected_items,
       SUM(input_tokens) AS wasted_input,
       SUM(output_tokens) AS wasted_output
FROM ai_usage_log
WHERE pipeline_step = 'quality_gate'
  AND raw_feedback_item_id IN (
    SELECT raw_feedback_item_id FROM pipeline_log
    WHERE event_type = 'quality_gate.rejected'
  );

-- Average latency by step
SELECT pipeline_step, AVG(duration_ms) AS avg_ms, MAX(duration_ms) AS max_ms
FROM ai_usage_log WHERE status = 'success' GROUP BY 1;

-- Retry frequency
SELECT pipeline_step,
       COUNT(*) FILTER (WHERE retry_count > 0) AS retried,
       AVG(retry_count) FILTER (WHERE retry_count > 0) AS avg_retries,
       COUNT(*) AS total
FROM ai_usage_log GROUP BY 1;

-- Error rate
SELECT pipeline_step,
       COUNT(*) FILTER (WHERE status = 'error') AS errors,
       COUNT(*) AS total
FROM ai_usage_log GROUP BY 1;
```

---

# Part 2: Pipeline Audit Log

## Problem

Processing decisions are lost at every stage. Currently discarded:

| Data point                                  | Stage          | Impact                                                             |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| Dedup collision (duplicate arrival)         | Ingestion      | Can't measure duplicate rate                                       |
| Author resolution method                    | Enrichment     | Can't debug identity issues                                        |
| Quality gate tier + reason                  | Quality gate   | Can't tell WHY items were dismissed                                |
| AI-generated subject flag                   | Quality gate   | Can't distinguish AI vs human titles                               |
| Feedback signals below confidence threshold | Extraction     | Can't measure filter loss                                          |
| Feedback signals beyond the 5-signal cap    | Extraction     | Can't measure cap loss                                             |
| Feedback signal types extracted             | Extraction     | Can't analyze extraction patterns                                  |
| Vote vs create decision rationale           | Interpretation | Can't audit suggestion logic                                       |
| Dedup skip (similar pending suggestion)     | Interpretation | Can't measure dedup effectiveness                                  |
| Suggestion was fallback-generated           | Interpretation | Can't measure LLM failure rate                                     |
| Dismiss / expiry reason                     | Resolution     | Can't analyze reject patterns or feed future recommendation tuning |
| Admin edits delta vs AI suggestion          | Resolution     | Can't measure AI suggestion quality                                |

## Design

### New table: `pipeline_log`

One row per significant processing event. Chronological audit trail keyed to the raw feedback item.

```sql
CREATE TABLE pipeline_log (
  id                    uuid PRIMARY KEY,
  event_type            varchar(50) NOT NULL,   -- see event catalog below
  raw_feedback_item_id  uuid REFERENCES raw_feedback_items(id) ON DELETE SET NULL,
  signal_id             uuid REFERENCES feedback_signals(id) ON DELETE SET NULL,
  suggestion_id         uuid REFERENCES feedback_suggestions(id) ON DELETE SET NULL,
  post_id               uuid REFERENCES posts(id) ON DELETE SET NULL,
  detail                jsonb NOT NULL DEFAULT '{}',  -- event-specific payload
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pipeline_log_raw_item_idx ON pipeline_log (raw_feedback_item_id);
CREATE INDEX pipeline_log_event_type_idx ON pipeline_log (event_type);
CREATE INDEX pipeline_log_created_idx ON pipeline_log (created_at);
```

FKs with `ON DELETE SET NULL` are appropriate here (unlike ai_usage_log which has no FKs at all) because pipeline_log IS domain data — but rows should survive source deletion so aggregate analysis (reject rates, extraction patterns, etc.) remains valid through the full 180-day retention window. The retention job handles actual cleanup.

### TypeID prefix

Add `pipeline_log` to `packages/ids/src/prefixes.ts` with prefix `plog`.

### Event catalog

#### Ingestion events

| `event_type`             | Emitted from          | `detail` payload                                                                     |
| ------------------------ | --------------------- | ------------------------------------------------------------------------------------ |
| `ingestion.received`     | `ingestRawFeedback()` | `{ sourceType, sourceId, dedupeKey, externalId, hasAuthorEmail, hasExternalUserId }` |
| `ingestion.deduplicated` | `ingestRawFeedback()` | `{ dedupeKey, existingItemId }`                                                      |

#### Enrichment events

| `event_type`                 | Emitted from         | `detail` payload                                                                                        |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| `enrichment.author_resolved` | `enrichAndAdvance()` | `{ method: 'email' \| 'external_id' \| 'created_new' \| 'unresolvable', principalId, externalUserId? }` |

#### Quality gate events

| `event_type`            | Emitted from       | `detail` payload                                                           |
| ----------------------- | ------------------ | -------------------------------------------------------------------------- |
| `quality_gate.passed`   | `extractSignals()` | `{ tier: 1\|2\|3, reason, isChannelMonitor, sourceType, suggestedTitle? }` |
| `quality_gate.rejected` | `extractSignals()` | `{ tier: 1\|2\|3, reason, isChannelMonitor, sourceType }`                  |

#### Extraction events

| `event_type`           | Emitted from       | `detail` payload                                                                                             |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `extraction.completed` | `extractSignals()` | `{ signalsExtracted, signalsBelowThreshold, signalsCapped, signalTypes, confidences, model, promptVersion }` |
| `extraction.failed`    | `extractSignals()` | `{ error, attemptCount }`                                                                                    |

`signalTypes` and `confidences` are arrays capturing all extracted `feedback_signals` candidates (including filtered ones) for quality analysis.

#### Interpretation events

| `event_type`                        | Emitted from        | `detail` payload                                                              |
| ----------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| `interpretation.similar_posts`      | `interpretSignal()` | `{ postMatches: [{ postId, title, similarity }], bestSimilarity, threshold }` |
| `interpretation.suggestion_created` | `interpretSignal()` | `{ suggestionType, sourceType, bestSimilarity?, usedFallback, boardId }`      |
| `interpretation.suggestion_skipped` | `interpretSignal()` | `{ reason: 'duplicate_pending', similarSuggestionId, similarity }`            |
| `interpretation.skipped_quackback`  | `interpretSignal()` | `{}` (quackback source, no suggestion needed)                                 |
| `interpretation.failed`             | `interpretSignal()` | `{ error, currentAttempt, maxAttempts }`                                      |

`sourceType` denormalized on `suggestion_created` for direct querying without self-joins.

#### Recovery events

| `event_type`                     | Emitted from          | `detail` payload                                                                  |
| -------------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `recovery.raw_item_reset`        | `recoverStuckItems()` | `{ previousState, attemptCount, maxAttempts, nextState: 'ready_for_extraction' }` |
| `recovery.signal_reset`          | `recoverStuckItems()` | `{ previousState: 'interpreting', nextState: 'pending_interpretation' }`          |
| `recovery.max_attempts_exceeded` | `recoverStuckItems()` | `{ previousState, attemptCount, maxAttempts, error }`                             |

#### Resolution events

| `event_type`           | Emitted from                                          | `detail` payload                                                                                                                          |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `suggestion.accepted`  | `acceptCreateSuggestion()` / `acceptVoteSuggestion()` | `{ suggestionType, sourceType, resultPostId, resolvedByPrincipalId, edits?: { titleChanged, bodyChanged, boardChanged, authorChanged } }` |
| `suggestion.dismissed` | `dismissSuggestion()`                                 | `{ resolvedByPrincipalId, reasonCode, reasonNote? }`                                                                                      |
| `suggestion.expired`   | `expireStaleSuggestions()`                            | `{ expiredBy: 'system', reasonCode: 'stale', ageDays }`                                                                                   |

`sourceType` denormalized on `accepted` for accept-rate-by-source queries without joins.

## Implementation

### Step 9: Schema + migration

**Extend migration** `0030_ai_usage_and_pipeline_log.sql` to also include `pipeline_log` and structured dismiss-reason columns on `feedback_suggestions`.
**New file:** `packages/db/src/schema/pipeline-log.ts` with Drizzle table definition.
**Edit:** `packages/db/src/schema/index.ts` - export new table.
**Edit:** `packages/db/src/schema/feedback.ts` - add `dismissReasonCode` and `dismissReasonNote` to `feedback_suggestions`.
**Edit:** `packages/ids/src/prefixes.ts` - add `pipeline_log: 'plog'` prefix.
**Edit:** `packages/ids/src/types.ts` - add `PipelineLogId` type alias.

### Step 10: Logging helper

**New file:** `apps/web/src/lib/server/domains/feedback/pipeline/pipeline-log.ts`

```ts
interface LogPipelineEventParams {
  eventType: string
  rawFeedbackItemId?: string
  signalId?: string
  suggestionId?: string
  postId?: string
  detail: Record<string, unknown>
}

export async function logPipelineEvent(params: LogPipelineEventParams): Promise<void>
```

`pipeline_log` is domain audit data, so writes should also be awaited. For background jobs, let failures bubble so the job retries with its audit trail intact. For accept/dismiss flows, prefer writing the domain mutation and the audit row in the same DB transaction where practical.

### Step 11: Instrument ingestion (feedback-ingest.service.ts)

- `ingestion.received` on successful insert: `{ sourceType, sourceId, dedupeKey, externalId, hasAuthorEmail: !!author.email, hasExternalUserId: !!author.externalUserId }`
- `ingestion.deduplicated` on dedup hit: `{ dedupeKey, existingItemId }`

### Step 12: Instrument enrichment (feedback-ingest.service.ts)

- `enrichment.author_resolved` after author resolution: `{ method, principalId }`. Requires the author resolver to return which path it took (currently it doesn't).
- **Edit** `author-resolver.ts` to return `{ principalId, method }` instead of just `principalId`.

### Step 13: Instrument quality gate (extraction.service.ts)

- `quality_gate.passed` / `quality_gate.rejected` after `shouldExtract()` returns: `{ tier, reason, isChannelMonitor, sourceType, suggestedTitle? }`.
- Requires `shouldExtract()` to always return the tier number. **Edit** `QualityGateResult` to add `tier: 1 | 2 | 3`.

### Step 14: Instrument extraction (extraction.service.ts)

- `extraction.completed` after signals are filtered and inserted: `{ signalsExtracted, signalsBelowThreshold, signalsCapped, signalTypes, confidences, model, promptVersion }`.
- Track pre-filter and pre-cap counts before `.filter()` and `.slice()`.
- Capture `signalTypes` and `confidences` arrays from the raw LLM output (before filtering) so we can analyze what the model extracts vs what we keep.

### Step 15: Instrument interpretation (interpretation.service.ts)

- `interpretation.similar_posts` after `findSimilarPosts()`: `{ postMatches, bestSimilarity, threshold: VOTE_SUGGESTION_THRESHOLD }`
- `interpretation.suggestion_created` after `generateSuggestion()`: `{ suggestionType, sourceType, bestSimilarity, usedFallback, boardId }`
- `interpretation.suggestion_skipped` on dedup skip: `{ reason, similarSuggestionId, similarity }`
- `interpretation.skipped_quackback` for quackback source items
- Update `feedback-ai-queue.ts` to pass queue attempt context into `interpretSignal()` (for example `currentAttempt: job.attemptsMade + 1`, `maxAttempts: job.opts.attempts ?? 1`)
- `interpretation.failed` in the outer `catch` before the signal is marked failed: `{ error, currentAttempt, maxAttempts }`

### Step 16: Instrument stuck-item recovery (stuck-recovery.service.ts)

- `recovery.raw_item_reset` when a stuck raw item is reset to `ready_for_extraction`
- `recovery.signal_reset` when a stuck signal is reset to `pending_interpretation`
  - Load `rawFeedbackItemId` together with `signal.id` so the event is logged with both `raw_feedback_item_id` and `signal_id`, preserving the per-item audit trail
- `recovery.max_attempts_exceeded` when a raw item is permanently marked `failed`

### Step 17: Instrument suggestion resolution (suggestion.service.ts + feedback.ts + admin suggestions UI)

- `suggestion.accepted` in `acceptCreateSuggestion()` / `acceptVoteSuggestion()`:
  - For create: compute edit delta - `{ titleChanged: edits.title !== suggestion.suggestedTitle, bodyChanged: ..., boardChanged: ..., authorChanged: ... }`
  - For vote: `{ suggestionType: 'vote_on_post', resultPostId, resolvedByPrincipalId }`
  - Both: include `sourceType` from the raw item
- Extend `dismissSuggestionSchema` and the admin dismiss action to capture a structured `reasonCode` plus optional `reasonNote`
- Update both the single-dismiss path and the bulk `Dismiss all` path to require a reason via a confirmation dialog:
  - Required `reasonCode` dropdown: `not_relevant`, `duplicate`, `already_done`, `out_of_scope`, `other`
  - Optional free-text `reasonNote` field
  - Same dialog for both single and bulk dismiss — bulk applies the chosen reason to all selected suggestions
- Persist dismissal reason on `feedback_suggestions`, then emit `suggestion.dismissed`: `{ resolvedByPrincipalId, reasonCode, reasonNote? }`
- Change `expireStaleSuggestions()` to load the rows it expires and emit one `suggestion.expired` event per suggestion/raw item instead of a single bulk count event
- Structured dismiss reasons are also a useful future signal for improving recommendation quality or maintaining an internal review memory, but that feedback loop is out of scope for this implementation

## Pipeline audit queries

```sql
-- Full processing trace for a single feedback item
SELECT event_type, detail, created_at
FROM pipeline_log WHERE raw_feedback_item_id = ?
ORDER BY created_at;

-- Quality gate pass/reject rate by tier
SELECT detail->>'tier' AS tier,
       COUNT(*) FILTER (WHERE event_type = 'quality_gate.passed') AS passed,
       COUNT(*) FILTER (WHERE event_type = 'quality_gate.rejected') AS rejected
FROM pipeline_log WHERE event_type LIKE 'quality_gate.%'
GROUP BY 1;

-- Quality gate reject rate by source (is Slack noisy?)
SELECT detail->>'sourceType' AS source,
       COUNT(*) FILTER (WHERE event_type = 'quality_gate.rejected') AS rejected,
       COUNT(*) AS total
FROM pipeline_log WHERE event_type LIKE 'quality_gate.%'
GROUP BY 1;

-- Duplicate ingestion rate
SELECT date_trunc('day', created_at) AS day, COUNT(*)
FROM pipeline_log WHERE event_type = 'ingestion.deduplicated'
GROUP BY 1 ORDER BY 1 DESC;

-- Suggestion type distribution
SELECT detail->>'suggestionType' AS type, COUNT(*)
FROM pipeline_log WHERE event_type = 'interpretation.suggestion_created'
GROUP BY 1;

-- Accept rate by source type
SELECT detail->>'sourceType' AS source,
       COUNT(*) AS accepted
FROM pipeline_log WHERE event_type = 'suggestion.accepted'
GROUP BY 1;

-- Admin edit rate (how often PMs change AI suggestions)
SELECT COUNT(*) FILTER (WHERE (detail->'edits'->>'titleChanged')::bool) AS title_edits,
       COUNT(*) FILTER (WHERE (detail->'edits'->>'bodyChanged')::bool) AS body_edits,
       COUNT(*) FILTER (WHERE (detail->'edits'->>'boardChanged')::bool) AS board_edits,
       COUNT(*) AS total_accepts
FROM pipeline_log WHERE event_type = 'suggestion.accepted'
  AND detail ? 'edits';

-- Dedup effectiveness
SELECT COUNT(*) AS skipped,
       AVG((detail->>'similarity')::float) AS avg_similarity
FROM pipeline_log WHERE event_type = 'interpretation.suggestion_skipped';

-- Feedback signal filter loss (how many feedback_signals get dropped by threshold/cap)
SELECT SUM((detail->>'signalsBelowThreshold')::int) AS threshold_filtered,
       SUM((detail->>'signalsCapped')::int) AS cap_filtered,
       SUM((detail->>'signalsExtracted')::int) AS kept
FROM pipeline_log WHERE event_type = 'extraction.completed';

-- Feedback signal type distribution (what kinds of feedback_signals does the LLM extract?)
SELECT signal_type, COUNT(*)
FROM pipeline_log,
     jsonb_array_elements_text(detail->'signalTypes') AS signal_type
WHERE event_type = 'extraction.completed'
GROUP BY 1 ORDER BY 2 DESC;

-- End-to-end processing time per item
SELECT raw_feedback_item_id,
       MIN(created_at) AS started,
       MAX(created_at) AS finished,
       EXTRACT(EPOCH FROM MAX(created_at) - MIN(created_at)) AS seconds
FROM pipeline_log
WHERE raw_feedback_item_id IS NOT NULL
GROUP BY 1 ORDER BY seconds DESC;

-- Fallback rate (how often does the suggestion LLM fail?)
SELECT COUNT(*) FILTER (WHERE (detail->>'usedFallback')::bool) AS fallback,
       COUNT(*) AS total
FROM pipeline_log WHERE event_type = 'interpretation.suggestion_created';
```

---

# Retention

Both tables are append-only. Add a scheduled cleanup job:

- `ai_usage_log`: retain 90 days (high volume, cost data has diminishing value over time)
- `pipeline_log`: retain 180 days (lower volume, audit trail has longer-term value)

No rollup tables in v1. Downstream consumers, including the analytics page, must respect these retention windows directly.

### Step 18: Retention cleanup job

**New file:** `apps/web/src/lib/server/domains/ai/usage-retention.ts`

Register a BullMQ repeatable job (runs daily) that deletes expired rows:

```sql
DELETE FROM ai_usage_log WHERE created_at < now() - interval '90 days';
DELETE FROM pipeline_log WHERE created_at < now() - interval '180 days';
```

Wire the repeatable job registration into the existing worker initialization in `feedback-ai-queue.ts`.

---

# Complete files changed summary

| File                                                                                           | Change                                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/db/drizzle/0030_ai_usage_and_pipeline_log.sql`                                       | New migration (both tables)                                                                |
| `packages/db/src/schema/ai-usage-log.ts`                                                       | New Drizzle table definition                                                               |
| `packages/db/src/schema/pipeline-log.ts`                                                       | New Drizzle table definition                                                               |
| `packages/db/src/schema/feedback.ts`                                                           | Add structured dismiss-reason columns to `feedback_suggestions`                            |
| `packages/db/src/schema/index.ts`                                                              | Export both new tables                                                                     |
| `packages/ids/src/prefixes.ts`                                                                 | Add `ai_usage: 'ailog'`, `pipeline_log: 'plog'`                                            |
| `packages/ids/src/types.ts`                                                                    | Add `AiUsageLogId`, `PipelineLogId` types                                                  |
| `apps/web/src/lib/server/domains/ai/usage-log.ts`                                              | New: `logAiUsage()` + `withUsageLogging()`                                                 |
| `apps/web/src/lib/server/domains/ai/retry.ts`                                                  | Return `{ result, retryCount }` from `withRetry`                                           |
| `apps/web/src/lib/server/domains/feedback/pipeline/pipeline-log.ts`                            | New: `logPipelineEvent()`                                                                  |
| `apps/web/src/lib/server/domains/summary/summary.service.ts`                                   | Adapt to `withRetry()` returning `{ result, retryCount }`                                  |
| `apps/web/src/lib/server/domains/merge-suggestions/merge-assessment.service.ts`                | Adapt to `withRetry()` returning `{ result, retryCount }`                                  |
| `apps/web/src/lib/server/domains/feedback/pipeline/__tests__/quality-gate.service.test.ts`     | Update `withRetry` mock to return `{ result, retryCount: 0 }`                              |
| `apps/web/src/lib/server/domains/feedback/pipeline/__tests__/extraction.service.test.ts`       | Update `withRetry` mock to return `{ result, retryCount: 0 }`                              |
| `apps/web/src/lib/server/domains/feedback/pipeline/__tests__/interpretation.service.test.ts`   | Update `withRetry` mock to return `{ result, retryCount: 0 }`                              |
| `apps/web/src/lib/server/domains/feedback/pipeline/__tests__/embedding.service.test.ts`        | Update `withRetry` mock to return `{ result, retryCount: 0 }`                              |
| `apps/web/src/lib/server/domains/merge-suggestions/__tests__/merge-assessment.service.test.ts` | Update `withRetry` mock to return `{ result, retryCount: 0 }`                              |
| `apps/web/src/lib/server/domains/ai/usage-retention.ts`                                        | New: daily BullMQ retention cleanup job                                                    |
| `apps/web/src/lib/server/domains/feedback/queues/feedback-ai-queue.ts`                         | Pass queue attempt metadata into interpretation logging; register retention repeatable job |
| `apps/web/src/lib/server/domains/feedback/pipeline/quality-gate.service.ts`                    | Add rawFeedbackItemId param, return tier, wrap LLM                                         |
| `apps/web/src/lib/server/domains/feedback/pipeline/extraction.service.ts`                      | Wrap LLM, thread rawItemId, log gate + extraction events, capture signal types/confidences |
| `apps/web/src/lib/server/domains/feedback/pipeline/interpretation.service.ts`                  | Wrap LLM, log similar posts + suggestion events with sourceType                            |
| `apps/web/src/lib/server/domains/feedback/pipeline/embedding.service.ts`                       | Wrap embedding call                                                                        |
| `apps/web/src/lib/server/domains/feedback/pipeline/stuck-recovery.service.ts`                  | Log recovery and permanent-failure events                                                  |
| `apps/web/src/lib/server/domains/feedback/pipeline/suggestion.service.ts`                      | Log accept/dismiss/expire events with edit deltas and sourceType                           |
| `apps/web/src/lib/server/domains/feedback/ingestion/feedback-ingest.service.ts`                | Log ingestion + enrichment events                                                          |
| `apps/web/src/lib/server/domains/feedback/ingestion/author-resolver.ts`                        | Return `{ principalId, method }`                                                           |
| `apps/web/src/lib/server/domains/embeddings/embedding.service.ts`                              | Accept optional usage-log context in `generateEmbedding()`                                 |
| `apps/web/src/lib/server/domains/sentiment/sentiment.service.ts`                               | Wrap LLM call                                                                              |
| `apps/web/src/lib/server/functions/feedback.ts`                                                | Accept dismiss reason in server function schema                                            |
| `apps/web/src/components/admin/feedback/suggestions/*.tsx`                                     | Capture dismiss reason in the admin triage UI                                              |

# Analytical questions this answers

| Question                                              | Data source                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| How much is AI costing per month?                     | `ai_usage_log` aggregate                                                                                     |
| Cost per feedback item?                               | `ai_usage_log` GROUP BY `raw_feedback_item_id`                                                               |
| Cost per raw item that led to an accepted suggestion? | `ai_usage_log` + distinct accepted raw items                                                                 |
| Wasted spend on rejected items?                       | `ai_usage_log` JOIN `pipeline_log` quality_gate.rejected                                                     |
| Why was this item rejected?                           | `pipeline_log` quality_gate.rejected detail                                                                  |
| Full processing trace for item X?                     | `pipeline_log` WHERE `raw_feedback_item_id = X`                                                              |
| How good are AI suggestions?                          | `pipeline_log` suggestion.accepted edit delta rates                                                          |
| Why are suggestions being dismissed?                  | `feedback_suggestions` dismiss reason + `pipeline_log` suggestion.dismissed                                  |
| Is Slack channel monitoring noisy?                    | `pipeline_log` quality_gate reject rate by sourceType                                                        |
| Should we adjust the quality gate?                    | `pipeline_log` tier distribution + `ai_usage_log` wasted cost                                                |
| How long does processing take?                        | `pipeline_log` end-to-end timestamps                                                                         |
| Are we seeing lots of duplicates?                     | `pipeline_log` ingestion.deduplicated + interpretation.suggestion_skipped                                    |
| Which models cost most?                               | `ai_usage_log` GROUP BY model                                                                                |
| Is the pipeline healthy?                              | `ai_usage_log` error/retry rates + `pipeline_log` extraction.failed + `interpretation.failed` + `recovery.%` |
| How often do retries happen?                          | `ai_usage_log` retry_count                                                                                   |
| What feedback signal types does the LLM extract?      | `pipeline_log` extraction.completed signalTypes                                                              |
| How often do PMs override board selection?            | `pipeline_log` suggestion.accepted boardChanged                                                              |
| Vote vs create decision distribution?                 | `pipeline_log` interpretation.suggestion_created suggestionType                                              |
| Fallback suggestion rate?                             | `pipeline_log` interpretation.suggestion_created usedFallback                                                |

---

# Related plan

The analytics UI, server queries, and admin navigation changes that were previously in Part 3 now live in [`2026-03-09-feat-admin-analytics-plan.md`](./2026-03-09-feat-admin-analytics-plan.md). Keeping this document focused on logging/data capture makes the implementation sequence clearer:

1. Land `ai_usage_log` and `pipeline_log`.
2. Backfill or validate the captured data.
3. Build analytics against those tables in a separate follow-on change.

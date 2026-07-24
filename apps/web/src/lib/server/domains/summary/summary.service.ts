/**
 * Post summary service.
 *
 * Generates AI-powered structured summaries of posts and their comment threads.
 * Summaries include a prose overview, urgency level, key quotes, and next steps.
 */

import { chat } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { z } from 'zod'
import {
  db,
  posts,
  postComments,
  eq,
  and,
  or,
  isNull,
  ne,
  desc,
  sql,
  notInArray,
} from '@/lib/server/db'
import { config } from '@/lib/server/config'
import {
  isAiClientConfigured,
  structuredOutputProviderOptions,
} from '@/lib/server/domains/ai/config'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import type { PostId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'summary' })

/**
 * `chat({ outputSchema })` collapses "empty response", "response wasn't
 * valid JSON", and "response didn't match the schema" into one thrown
 * `Error` tagged with one of these `code`s (see @tanstack/ai's
 * `finalizationError` handling) — the structured-output analogue of this
 * service's old empty-response / JSON.parse / shape-guard branches, all of
 * which logged and returned rather than throwing. A transport/network
 * failure throws too, but without this `code`, so it still propagates
 * exactly as an uncaught `withRetry` failure did before.
 */
const STRUCTURED_OUTPUT_ERROR_CODES = new Set([
  'structured-output-parse-failed',
  'structured-output-validation-failed',
  'structured-output-missing-result',
])

function isStructuredOutputError(err: unknown): boolean {
  return STRUCTURED_OUTPUT_ERROR_CODES.has(
    (err as { code?: string } | null | undefined)?.code ?? ''
  )
}

const SYSTEM_PROMPT = `You are a product feedback analyst writing post briefs for a PM's triage queue.
Your job is to surface what matters for prioritization, not restate the obvious.

Return strict JSON only:
{
  "summary": "string",
  "keyQuotes": ["string"],
  "nextSteps": ["string"]
}

Rules for "summary" (1-3 sentences):
- Lead with the core user need or problem, not "Users are requesting X."
- Name specifics: what feature, what workflow, what breaks.
- If comments add context beyond the original post, synthesize it.
- If there is disagreement or pushback in the thread, note the tension.
- Write for a PM who has 5 seconds to decide whether to dig deeper.
- BAD: "Users are requesting improvements to the export functionality."
- GOOD: "CSV exports silently drop columns with special characters, affecting 3 users. Team acknowledged but no fix timeline given."

Rules for "keyQuotes" (0-2):
- Only quote user/customer text, never team replies.
- Pick quotes that capture the emotional or factual core.
- Keep each under 120 characters. Truncate with "..." if needed.
- Omit if the post body alone is sufficient.

Rules for "nextSteps" (0-2):
- Start each with a verb: "Investigate...", "Reproduce...", "Respond to..."
- Only include when the discussion has enough specificity for a real action.
- Never include generic advice like "Consider user feedback."

Example output:
{
  "summary": "CSV exports silently drop columns with special characters, affecting 3 users. Team acknowledged but no fix timeline given.",
  "keyQuotes": ["Half our accounting columns just vanish from the export..."],
  "nextSteps": ["Reproduce the export with non-ASCII column headers"]
}`

interface PostSummaryJson {
  summary: string
  keyQuotes: string[]
  nextSteps: string[]
}

// `summary` mirrors the old typeof-guard: a missing/wrong-typed value fails
// validation, which the caller maps to the old "invalid shape" log+return.
// `keyQuotes`/`nextSteps` mirror the old Array.isArray coercion: `.catch([])`
// swallows a missing or wrong-shaped value locally (without failing the rest
// of the object), replacing it with `[]` exactly like the old manual coercion.
const PostSummarySchema = z.object({
  summary: z.string(),
  keyQuotes: z.array(z.string()).catch([]),
  nextSteps: z.array(z.string()).catch([]),
})

/**
 * Generate and save an AI summary for a post.
 * Fetches the post title, content, and comments, then calls the LLM.
 */
export async function generateAndSavePostSummary(postId: PostId): Promise<void> {
  await enforceAiTokenBudget()

  const model = getChatModel('summary')
  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) || !model) return

  // Fetch post (include existing summary for continuity on updates)
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    columns: { title: true, content: true, summaryJson: true },
  })
  if (!post) {
    log.warn({ post_id: postId }, 'post not found for summary')
    return
  }

  // Fetch comments (lightweight: just content and author name)
  const commentRows = await db
    .select({
      content: postComments.content,
      isTeamMember: postComments.isTeamMember,
    })
    .from(postComments)
    .where(and(eq(postComments.postId, postId), isNull(postComments.deletedAt)))
    .orderBy(postComments.createdAt)

  // Build prompt input
  let input = `# ${post.title}\n\n${post.content}`

  if (commentRows.length > 0) {
    input += '\n\n## Comments\n'
    for (const c of commentRows) {
      const prefix = c.isTeamMember ? '[Team]' : '[User]'
      input += `\n${prefix}: ${c.content}`
    }
  }

  // Include existing summary for continuity when refreshing
  const existingSummary = post.summaryJson as PostSummaryJson | null
  if (existingSummary) {
    input += '\n\n## Previous Summary\n'
    input += JSON.stringify(existingSummary)
  }

  // Truncate to ~6000 chars to stay within token limits
  if (input.length > 6000) {
    input = input.slice(0, 6000) + '\n\n[truncated]'
  }

  const systemPrompt = existingSummary
    ? SYSTEM_PROMPT +
      '\n\nA previous summary is included. Update it to reflect the current state of the discussion — preserve existing context that is still relevant, and incorporate any new information from recent comments.'
    : SYSTEM_PROMPT

  let summaryJson: PostSummaryJson
  try {
    summaryJson = await chat({
      adapter: openaiCompatibleText(model, {
        baseURL: config.openaiBaseUrl!,
        apiKey: config.openaiApiKey!,
      }),
      systemPrompts: [systemPrompt],
      messages: [{ role: 'user', content: input }],
      outputSchema: PostSummarySchema,
      stream: false,
      modelOptions: { max_tokens: 1000, ...structuredOutputProviderOptions() },
    })
  } catch (err) {
    if (!isStructuredOutputError(err)) throw err
    log.error({ post_id: postId, err }, 'failed to parse summary json')
    return
  }

  await db
    .update(posts)
    .set({
      summaryJson,
      summaryModel: model,
      summaryUpdatedAt: new Date(),
      summaryCommentCount: commentRows.length,
    })
    .where(eq(posts.id, postId))

  log.info({ post_id: postId, comment_count: commentRows.length }, 'post summary generated')
}

const SWEEP_BATCH_SIZE = 50
const SWEEP_BATCH_DELAY_MS = 500
const SWEEP_ABORT_AFTER_EMPTY_BATCHES = 2

let _sweepInProgress = false

/**
 * Refresh stale summaries.
 *
 * Finds all posts where the summary is missing or the live comment count has
 * changed, and processes them in batches until none remain. See #180 for why
 * the sweep needs an attempted-set, circuit breaker, and reentrancy guard.
 */
export async function refreshStaleSummaries(): Promise<void> {
  // Fast-path skip when AI is off OR the summary model is unset/disabled —
  // otherwise the sweep would query a batch and per-post no-op until the
  // circuit breaker trips.
  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) || !getChatModel('summary'))
    return
  if (_sweepInProgress) return
  _sweepInProgress = true
  try {
    await _doSweep()
  } finally {
    _sweepInProgress = false
  }
}

async function _doSweep(): Promise<void> {
  const liveCommentCountSq = db
    .select({
      postId: postComments.postId,
      count: sql<number>`count(*)::int`.as('live_count'),
    })
    .from(postComments)
    .where(isNull(postComments.deletedAt))
    .groupBy(postComments.postId)
    .as('live_cc')

  // Failed rows stay stale (summaryJson NULL); without skipping them we'd
  // re-hit the same top-of-order rows every iteration. Excluding at the DB
  // level (not client-side after LIMIT) is what lets the sweep peel past a
  // block of permanent failures and reach healthy rows below them.
  const attempted = new Set<PostId>()
  let totalProcessed = 0
  let totalFailed = 0
  let consecutiveEmptyBatches = 0

  while (true) {
    const stalePosts = await db
      .select({ id: posts.id })
      .from(posts)
      .leftJoin(liveCommentCountSq, eq(posts.id, liveCommentCountSq.postId))
      .where(
        and(
          isNull(posts.deletedAt),
          or(
            isNull(posts.summaryJson),
            ne(posts.summaryCommentCount, sql`coalesce(${liveCommentCountSq.count}, 0)`)
          ),
          attempted.size > 0 ? notInArray(posts.id, [...attempted]) : undefined
        )
      )
      .orderBy(desc(posts.updatedAt))
      .limit(SWEEP_BATCH_SIZE)

    if (stalePosts.length === 0) break

    if (totalProcessed === 0 && totalFailed === 0) {
      log.debug('found stale posts, processing summary sweep')
    }

    let batchSucceeded = 0
    for (const { id } of stalePosts) {
      attempted.add(id)
      try {
        await generateAndSavePostSummary(id)
        totalProcessed++
        batchSucceeded++
      } catch (err) {
        totalFailed++
        log.error({ post_id: id, err }, 'failed to refresh post summary')
      }
    }

    // Two consecutive zero-success batches almost always means a systemic
    // problem (bad model id, revoked key, upstream down). One zero-success
    // batch alone isn't enough — it can just be a block of permanent failures
    // at the top of the order that we need to skip past to reach healthy rows.
    if (batchSucceeded === 0) {
      consecutiveEmptyBatches++
      if (consecutiveEmptyBatches >= SWEEP_ABORT_AFTER_EMPTY_BATCHES) {
        log.error(
          {
            consecutive_empty_batches: consecutiveEmptyBatches,
            processed: totalProcessed,
            failed: totalFailed,
          },
          'aborting summary sweep after consecutive empty batches'
        )
        break
      }
    } else {
      consecutiveEmptyBatches = 0
      log.debug({ processed: totalProcessed, failed: totalFailed }, 'summary sweep progress')
    }

    await new Promise((resolve) => setTimeout(resolve, SWEEP_BATCH_DELAY_MS))
  }

  if (totalProcessed > 0 || totalFailed > 0) {
    log.info({ processed: totalProcessed, failed: totalFailed }, 'summary sweep completed')
  }
}

/**
 * Merge check orchestrator — per-post checking and periodic sweep.
 *
 * Mirrors the AI summary pattern: event-driven + periodic sweep.
 */

import { db, posts, and, isNull, isNotNull, desc, eq, notInArray } from '@/lib/server/db'
import { getOpenAI } from '@/lib/server/domains/ai/config'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { findMergeCandidates } from './merge-search.service'
import { assessMergeCandidates, determineDirection } from './merge-assessment.service'
import { createMergeSuggestion, expireStaleMergeSuggestions } from './merge-suggestion.service'
import { logger } from '@/lib/server/logger'
import type { PostId } from '@quackback/ids'

const log = logger.child({ component: 'merge-check' })

const SWEEP_BATCH_SIZE = 50
const SWEEP_POST_DELAY_MS = 500
const SWEEP_ABORT_AFTER_EMPTY_BATCHES = 2

/**
 * Check a single post for merge candidates.
 * Runs hybrid search → LLM assessment → creates suggestions.
 */
export async function checkPostForMergeCandidates(postId: PostId): Promise<void> {
  // Fetch post
  const post = await db.query.posts.findFirst({
    where: (p, { eq }) => eq(p.id, postId),
    columns: {
      id: true,
      title: true,
      content: true,
      voteCount: true,
      commentCount: true,
      createdAt: true,
      deletedAt: true,
      canonicalPostId: true,
      embedding: true,
    },
  })

  // Bail if deleted, merged, or no embedding
  if (!post || post.deletedAt || post.canonicalPostId || !post.embedding) {
    return
  }

  // Bail early if AI is not configured — skip the candidate search entirely
  const model = getChatModel('merge')
  if (!getOpenAI() || !model) return

  // Step 1: Hybrid search (pass already-fetched post to avoid redundant DB query)
  const candidates = await findMergeCandidates(postId, {
    sourcePost: { title: post.title, embedding: post.embedding },
  })
  if (candidates.length === 0) {
    await updateMergeCheckedAt(postId)
    return
  }

  log.info({ candidate_count: candidates.length, post_id: postId }, 'found merge candidates')

  // Step 2: LLM verification
  const assessments = await assessMergeCandidates(
    { id: post.id, title: post.title, content: post.content },
    candidates,
    model
  )

  log.info({ duplicate_count: assessments.length, post_id: postId }, 'llm confirmed duplicates')

  // Step 3: Pick single best match (highest confidence, tiebreak by hybrid score)
  const bestAssessment = assessments.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    const candA = candidates.find((c) => c.postId === a.candidatePostId)
    const candB = candidates.find((c) => c.postId === b.candidatePostId)
    return (candB?.hybridScore ?? 0) - (candA?.hybridScore ?? 0)
  })[0]

  const bestCandidate = bestAssessment
    ? candidates.find((c) => c.postId === bestAssessment.candidatePostId)
    : undefined

  if (bestAssessment && bestCandidate) {
    const { sourcePostId, targetPostId } = determineDirection(
      {
        id: post.id,
        voteCount: post.voteCount,
        commentCount: post.commentCount,
        createdAt: post.createdAt,
      },
      {
        id: bestCandidate.postId,
        voteCount: bestCandidate.voteCount,
        commentCount: bestCandidate.commentCount,
        createdAt: bestCandidate.createdAt,
      }
    )

    await createMergeSuggestion({
      sourcePostId,
      targetPostId,
      vectorScore: bestCandidate.vectorScore,
      ftsScore: bestCandidate.ftsScore,
      hybridScore: bestCandidate.hybridScore,
      llmConfidence: bestAssessment.confidence,
      llmReasoning: bestAssessment.reasoning,
      llmModel: model,
    })
  }

  await updateMergeCheckedAt(postId)
}

let _sweepInProgress = false

/**
 * Periodic sweep — find posts that haven't been checked recently and process them.
 * Mirrors the refreshStaleSummaries pattern from summary.service.ts.
 */
export async function sweepMergeSuggestions(): Promise<void> {
  if (!getOpenAI() || !getChatModel('merge')) return
  if (_sweepInProgress) return
  _sweepInProgress = true

  try {
    await _doSweep()
  } finally {
    _sweepInProgress = false
  }
}

async function _doSweep(): Promise<void> {
  // Failed rows stay stale (mergeCheckedAt is only stamped on success), so
  // without an attempted-set the DB query keeps returning the same top-of-
  // order batch every iteration. See #180 for the runaway-loop story this
  // mirrors from the summary sweep.
  const attempted = new Set<PostId>()
  let totalProcessed = 0
  let totalFailed = 0
  let consecutiveEmptyBatches = 0

  while (true) {
    const stalePosts = await db
      .select({ id: posts.id })
      .from(posts)
      .where(
        and(
          isNull(posts.deletedAt),
          isNull(posts.canonicalPostId),
          isNotNull(posts.embedding),
          isNull(posts.mergeCheckedAt),
          attempted.size > 0 ? notInArray(posts.id, [...attempted]) : undefined
        )
      )
      .orderBy(desc(posts.updatedAt))
      .limit(SWEEP_BATCH_SIZE)

    if (stalePosts.length === 0) break

    if (totalProcessed === 0 && totalFailed === 0) {
      log.info('sweep found stale posts')
    }

    let batchSucceeded = 0
    for (const { id } of stalePosts) {
      attempted.add(id)
      try {
        await checkPostForMergeCandidates(id)
        totalProcessed++
        batchSucceeded++
        // Rate-limit pacing only matters when a call actually consumed quota.
        // A failed call (e.g. 400 invalid-model from #180) didn't, and pacing
        // it would make the circuit-break path block for batchSize * delayMs
        // before the abort check can fire. withRetry already handles 429
        // backoff before surfacing the error here.
        await new Promise((resolve) => setTimeout(resolve, SWEEP_POST_DELAY_MS))
      } catch (err) {
        totalFailed++
        log.error({ err, post_id: id }, 'failed to check post')
      }
    }

    // Two consecutive zero-success batches almost always means a systemic
    // problem (bad model id, revoked key, upstream down). One alone can just
    // be a block of permanent failures we need to skip past via the attempted
    // exclusion to reach healthy rows below them.
    if (batchSucceeded === 0) {
      consecutiveEmptyBatches++
      if (consecutiveEmptyBatches >= SWEEP_ABORT_AFTER_EMPTY_BATCHES) {
        log.error(
          {
            consecutive_empty_batches: consecutiveEmptyBatches,
            total_processed: totalProcessed,
            total_failed: totalFailed,
          },
          'aborting sweep after consecutive empty batches'
        )
        break
      }
    } else {
      consecutiveEmptyBatches = 0
      log.debug({ total_processed: totalProcessed, total_failed: totalFailed }, 'sweep progress')
    }
  }

  // Expire old suggestions
  const expired = await expireStaleMergeSuggestions()
  if (expired > 0) {
    log.info({ expired_count: expired }, 'expired stale suggestions')
  }

  if (totalProcessed > 0) {
    log.info({ total_processed: totalProcessed, total_failed: totalFailed }, 'sweep complete')
  }
}

async function updateMergeCheckedAt(postId: PostId): Promise<void> {
  await db.update(posts).set({ mergeCheckedAt: new Date() }).where(eq(posts.id, postId))
}

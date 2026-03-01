/**
 * Merge check orchestrator — per-post checking and periodic sweep.
 *
 * Mirrors the AI summary pattern: event-driven + periodic sweep.
 */

import { db, posts, and, or, isNull, desc, eq, sql } from '@/lib/server/db'
import { getOpenAI } from '@/lib/server/domains/ai/config'
import { findMergeCandidates } from './merge-search.service'
import { assessMergeCandidates, determineDirection } from './merge-assessment.service'
import { createMergeSuggestion, expireStaleMergeSuggestions } from './merge-suggestion.service'
import type { PostId } from '@quackback/ids'

const SWEEP_BATCH_SIZE = 50
const SWEEP_POST_DELAY_MS = 500

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

  // Step 1: Hybrid search (pass already-fetched post to avoid redundant DB query)
  const candidates = await findMergeCandidates(postId, {
    sourcePost: { title: post.title, embedding: post.embedding },
  })
  if (candidates.length === 0) {
    await updateMergeCheckedAt(postId)
    return
  }

  console.log(`[MergeSuggestion] Found ${candidates.length} candidates for post ${postId}`)

  // Step 2: LLM verification
  const assessments = await assessMergeCandidates(
    { id: post.id, title: post.title, content: post.content },
    candidates
  )

  console.log(`[MergeSuggestion] LLM confirmed ${assessments.length} duplicates for post ${postId}`)

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
      llmModel: 'google/gemini-2.5-flash',
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
  if (!getOpenAI()) return
  if (_sweepInProgress) return
  _sweepInProgress = true

  try {
    await _doSweep()
  } finally {
    _sweepInProgress = false
  }
}

async function _doSweep(): Promise<void> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  let totalProcessed = 0
  let totalFailed = 0

  // Process in batches
  while (true) {
    const stalePosts = await db
      .select({ id: posts.id })
      .from(posts)
      .where(
        and(
          isNull(posts.deletedAt),
          isNull(posts.canonicalPostId),
          sql`${posts.embedding} IS NOT NULL`,
          or(isNull(posts.mergeCheckedAt), sql`${posts.mergeCheckedAt} < ${twentyFourHoursAgo}`)
        )
      )
      .orderBy(desc(posts.updatedAt))
      .limit(SWEEP_BATCH_SIZE)

    if (stalePosts.length === 0) break

    if (totalProcessed === 0) {
      console.log(`[MergeSuggestion] Sweep: found stale posts, processing...`)
    }

    for (const { id } of stalePosts) {
      try {
        await checkPostForMergeCandidates(id)
        totalProcessed++
      } catch (err) {
        totalFailed++
        console.error(`[MergeSuggestion] Failed to check post ${id}:`, err)
      }

      // Delay between posts to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, SWEEP_POST_DELAY_MS))
    }

    console.log(
      `[MergeSuggestion] Sweep progress: ${totalProcessed} processed, ${totalFailed} failed`
    )
  }

  // Expire old suggestions
  const expired = await expireStaleMergeSuggestions()
  if (expired > 0) {
    console.log(`[MergeSuggestion] Expired ${expired} stale suggestions`)
  }

  if (totalProcessed > 0) {
    console.log(
      `[MergeSuggestion] Sweep complete: ${totalProcessed} processed, ${totalFailed} failed`
    )
  }
}

async function updateMergeCheckedAt(postId: PostId): Promise<void> {
  await db.update(posts).set({ mergeCheckedAt: new Date() }).where(eq(posts.id, postId))
}

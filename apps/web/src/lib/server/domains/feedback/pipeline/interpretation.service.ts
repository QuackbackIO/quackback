/**
 * Pass 2: Signal interpretation service.
 *
 * Interprets extracted signals: embeds them and, for external sources,
 * generates suggestions. High-similarity matches produce vote_on_post
 * suggestions; otherwise create_post. Both types store similar post
 * candidates so the admin can switch between actions.
 *
 * Duplicate detection (post-to-post merging) is handled separately
 * by the merge_suggestions system.
 */

import { UnrecoverableError } from 'bullmq'
import { db, eq, feedbackSignals, rawFeedbackItems } from '@/lib/server/db'
import { getOpenAI } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
import { stripCodeFences } from '@/lib/server/domains/ai/parse'
import { embedSignal, findSimilarPosts } from './embedding.service'
import { createPostSuggestion, createVoteSuggestion } from './suggestion.service'
import { buildSuggestionPrompt } from './prompts/suggestion.prompt'
import type { SuggestionGenerationResult } from '../types'
import type { FeedbackSignalId, RawFeedbackItemId, BoardId, PostId } from '@quackback/ids'

const SUGGESTION_MODEL = 'google/gemini-3.1-flash-lite-preview'

/** Above this threshold, the primary suggestion is vote_on_post. */
const VOTE_SUGGESTION_THRESHOLD = 0.8

/** Minimum similarity to include in the candidate list. */
const SIMILAR_POST_MIN_SIMILARITY = 0.55

/**
 * Interpret a single signal: embed, find similar posts, generate suggestions.
 * Called by the {feedback-ai} queue worker.
 */
export async function interpretSignal(signalId: FeedbackSignalId): Promise<void> {
  const signal = await db.query.feedbackSignals.findFirst({
    where: eq(feedbackSignals.id, signalId),
  })

  if (!signal) {
    throw new UnrecoverableError(`Signal ${signalId} not found`)
  }

  if (signal.processingState !== 'pending_interpretation') {
    console.log(`[Interpretation] Skipping ${signalId} in state ${signal.processingState}`)
    return
  }

  await db
    .update(feedbackSignals)
    .set({ processingState: 'interpreting', updatedAt: new Date() })
    .where(eq(feedbackSignals.id, signalId))

  try {
    // Step 1: Embed the signal (always, for storage/dedup purposes)
    const signalEmbedding = await embedSignal(signalId)

    // Step 2: For external sources, check similarity and generate create_post suggestions.
    // Quackback posts only need embedding — duplicate detection is handled by the
    // separate merge_suggestions system.
    const rawItem = await db.query.rawFeedbackItems.findFirst({
      where: eq(rawFeedbackItems.id, signal.rawFeedbackItemId),
      columns: { sourceType: true, externalId: true, content: true, contextEnvelope: true },
    })

    if (!rawItem) {
      throw new UnrecoverableError(`Raw item ${signal.rawFeedbackItemId} not found`)
    }

    const isQuackback = rawItem.sourceType === 'quackback'

    // Extract user-provided boardId from context metadata (e.g. Slack shortcut board selection)
    const contextMetadata = (rawItem.contextEnvelope as Record<string, unknown> | null)
      ?.metadata as Record<string, unknown> | undefined
    const userProvidedBoardId = contextMetadata?.boardId as string | undefined

    if (!isQuackback) {
      // External source: find similar posts and always create a suggestion.
      // High similarity → vote_on_post, low/none → create_post.
      const similarPosts = signalEmbedding
        ? await findSimilarPosts(signalEmbedding, {
            limit: 5,
            minSimilarity: SIMILAR_POST_MIN_SIMILARITY,
          })
        : []

      const similarPostsJson = similarPosts.slice(0, 3).map((p) => ({
        postId: p.id,
        title: p.title,
        similarity: p.similarity,
        voteCount: p.voteCount,
      }))

      const bestMatch = similarPosts[0]

      const signalData = {
        signalType: signal.signalType,
        summary: signal.summary,
        implicitNeed: signal.implicitNeed ?? undefined,
        evidence: (signal.evidence ?? []) as string[],
      }
      const sourceContent = rawItem.content as { subject?: string; text?: string }

      if (bestMatch && bestMatch.similarity >= VOTE_SUGGESTION_THRESHOLD) {
        // Primary: vote on existing post
        await generateSuggestion({
          type: 'vote_on_post',
          signalId,
          rawFeedbackItemId: signal.rawFeedbackItemId as RawFeedbackItemId,
          signal: signalData,
          sourceContent,
          embedding: signalEmbedding ?? undefined,
          userProvidedBoardId,
          resultPostId: bestMatch.id as PostId,
          similarPosts: similarPostsJson,
        })
      } else {
        // Primary: create new post
        await generateSuggestion({
          type: 'create_post',
          signalId,
          rawFeedbackItemId: signal.rawFeedbackItemId as RawFeedbackItemId,
          signal: signalData,
          sourceContent,
          embedding: signalEmbedding ?? undefined,
          userProvidedBoardId,
          similarPosts: similarPostsJson.length > 0 ? similarPostsJson : undefined,
        })
      }
    }

    // Mark signal as completed
    await db
      .update(feedbackSignals)
      .set({
        processingState: 'completed',
        sentiment: signal.sentiment,
        urgency: signal.urgency,
        updatedAt: new Date(),
      })
      .where(eq(feedbackSignals.id, signalId))

    await checkRawItemCompletion(signal.rawFeedbackItemId)

    console.log(`[Interpretation] Completed signal ${signalId}`)
  } catch (error) {
    await db
      .update(feedbackSignals)
      .set({ processingState: 'failed', updatedAt: new Date() })
      .where(eq(feedbackSignals.id, signalId))

    await checkRawItemCompletion(signal.rawFeedbackItemId)

    throw error
  }
}

/**
 * Generate a suggestion (create_post or vote_on_post) using LLM to produce title/body.
 * Both types always generate title/body so the admin can switch between actions.
 */
async function generateSuggestion(opts: {
  type: 'create_post' | 'vote_on_post'
  signalId: FeedbackSignalId
  rawFeedbackItemId: RawFeedbackItemId
  signal: {
    signalType: string
    summary: string
    implicitNeed?: string
    evidence: string[]
  }
  sourceContent: { subject?: string; text?: string }
  embedding?: number[]
  userProvidedBoardId?: string
  resultPostId?: PostId
  similarPosts?: Array<{ postId: string; title: string; similarity: number; voteCount: number }>
}): Promise<void> {
  const openai = getOpenAI()

  // Load boards for the prompt
  const { boards: _boards } = await import('@/lib/server/db')
  const allBoards = await db.query.boards.findMany({
    columns: { id: true, name: true, slug: true },
  })

  // Validate user-provided boardId exists
  const validUserBoardId = opts.userProvidedBoardId
    ? allBoards.find((b) => b.id === opts.userProvidedBoardId)?.id
    : undefined

  let suggestedTitle = opts.signal.summary.slice(0, 100)
  let suggestedBody = opts.sourceContent.text?.slice(0, 500) ?? opts.signal.summary
  let reasoning = `Auto-generated from ${opts.signal.signalType} signal`
  let boardId = (validUserBoardId ?? allBoards[0]?.id) as BoardId | undefined

  if (openai) {
    const prompt = buildSuggestionPrompt({
      signal: opts.signal,
      sourceContent: opts.sourceContent,
      boards: allBoards,
    })

    try {
      const completion = await withRetry(() =>
        openai.chat.completions.create({
          model: SUGGESTION_MODEL,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_completion_tokens: 2000,
        })
      )

      const responseText = (completion as any).choices?.[0]?.message?.content
      if (responseText) {
        const result: SuggestionGenerationResult = JSON.parse(stripCodeFences(responseText))
        suggestedTitle = result.title
        suggestedBody = result.body
        reasoning = result.reasoning
        boardId = (validUserBoardId ?? result.boardId) as BoardId | undefined
      }
    } catch (err) {
      console.warn(`[Interpretation] LLM suggestion generation failed, using fallback:`, err)
    }
  }

  if (opts.type === 'vote_on_post' && opts.resultPostId) {
    await createVoteSuggestion({
      rawFeedbackItemId: opts.rawFeedbackItemId,
      signalId: opts.signalId,
      resultPostId: opts.resultPostId,
      boardId,
      suggestedTitle,
      suggestedBody,
      reasoning,
      embedding: opts.embedding,
      similarPosts: opts.similarPosts,
    })
  } else {
    await createPostSuggestion({
      rawFeedbackItemId: opts.rawFeedbackItemId,
      signalId: opts.signalId,
      boardId,
      suggestedTitle,
      suggestedBody,
      reasoning,
      embedding: opts.embedding,
      similarPosts: opts.similarPosts,
    })
  }
}

/**
 * Check if all signals for a raw item are terminal, and if so mark the raw item accordingly.
 */
async function checkRawItemCompletion(rawItemId: RawFeedbackItemId): Promise<void> {
  const allSignals = await db.query.feedbackSignals.findMany({
    where: eq(feedbackSignals.rawFeedbackItemId, rawItemId),
    columns: { id: true, processingState: true },
  })

  const hasInProgress = allSignals.some(
    (s) => s.processingState !== 'completed' && s.processingState !== 'failed'
  )
  if (hasInProgress) return

  const hasFailed = allSignals.some((s) => s.processingState === 'failed')

  await db
    .update(rawFeedbackItems)
    .set({
      processingState: hasFailed ? 'failed' : 'completed',
      stateChangedAt: new Date(),
      processedAt: hasFailed ? null : new Date(),
      lastError: hasFailed ? 'One or more signals failed interpretation' : null,
      updatedAt: new Date(),
    })
    .where(eq(rawFeedbackItems.id, rawItemId))
}

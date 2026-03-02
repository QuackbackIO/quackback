/**
 * Pass 2: Signal interpretation service.
 *
 * Interprets extracted signals: embeds them and, for external sources,
 * generates create_post suggestions when no similar posts exist.
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
import { createPostSuggestion } from './suggestion.service'
import { buildSuggestionPrompt } from './prompts/suggestion.prompt'
import type { SuggestionGenerationResult } from '../types'
import type { FeedbackSignalId, RawFeedbackItemId, BoardId } from '@quackback/ids'

const SUGGESTION_MODEL = 'google/gemini-2.5-flash'

/** Similarity threshold — external signals below this get a create_post suggestion. */
const CREATE_POST_SIMILARITY_THRESHOLD = 0.8

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
      columns: { sourceType: true, externalId: true, content: true },
    })

    if (!rawItem) {
      throw new UnrecoverableError(`Raw item ${signal.rawFeedbackItemId} not found`)
    }

    const isQuackback = rawItem.sourceType === 'quackback'

    if (!isQuackback) {
      // External source: check if similar posts exist to decide whether to suggest a new post
      if (signalEmbedding) {
        const similarPosts = await findSimilarPosts(signalEmbedding, {
          limit: 5,
          minSimilarity: CREATE_POST_SIMILARITY_THRESHOLD,
        })

        // Only suggest creating a new post when no similar posts exist
        if (similarPosts.length === 0) {
          await generateCreatePostSuggestion({
            signalId,
            rawFeedbackItemId: signal.rawFeedbackItemId as RawFeedbackItemId,
            signal: {
              signalType: signal.signalType,
              summary: signal.summary,
              implicitNeed: signal.implicitNeed ?? undefined,
              evidence: (signal.evidence ?? []) as string[],
            },
            sourceContent: rawItem.content as { subject?: string; text?: string },
            embedding: signalEmbedding ?? undefined,
          })
        }
      } else {
        // No embedding available — still try to create post suggestion
        await generateCreatePostSuggestion({
          signalId,
          rawFeedbackItemId: signal.rawFeedbackItemId as RawFeedbackItemId,
          signal: {
            signalType: signal.signalType,
            summary: signal.summary,
            implicitNeed: signal.implicitNeed ?? undefined,
            evidence: (signal.evidence ?? []) as string[],
          },
          sourceContent: rawItem.content as { subject?: string; text?: string },
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
 * Generate a create_post suggestion using LLM to produce title/body.
 */
async function generateCreatePostSuggestion(opts: {
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
}): Promise<void> {
  const openai = getOpenAI()

  // Load boards for the prompt
  const { boards: _boards } = await import('@/lib/server/db')
  const allBoards = await db.query.boards.findMany({
    columns: { id: true, name: true, slug: true },
  })

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

        await createPostSuggestion({
          rawFeedbackItemId: opts.rawFeedbackItemId,
          signalId: opts.signalId,
          boardId: result.boardId as BoardId | undefined,
          suggestedTitle: result.title,
          suggestedBody: result.body,
          reasoning: result.reasoning,
          embedding: opts.embedding,
        })
        return
      }
    } catch (err) {
      console.warn(`[Interpretation] LLM suggestion generation failed, using fallback:`, err)
    }
  }

  // Fallback: use signal summary directly
  await createPostSuggestion({
    rawFeedbackItemId: opts.rawFeedbackItemId,
    signalId: opts.signalId,
    boardId: allBoards[0]?.id as BoardId | undefined,
    suggestedTitle: opts.signal.summary.slice(0, 100),
    suggestedBody: opts.sourceContent.text?.slice(0, 500) ?? opts.signal.summary,
    reasoning: `Auto-generated from ${opts.signal.signalType} signal`,
    embedding: opts.embedding,
  })
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

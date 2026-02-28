/**
 * Pass 1: Signal extraction service.
 *
 * Calls LLM to extract feedback signals from a raw item.
 * Idempotent: clears existing signals before creating new ones.
 */

import { UnrecoverableError } from 'bullmq'
import { db, eq, rawFeedbackItems, feedbackSignals, sql } from '@/lib/server/db'
import { getOpenAI } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
import { buildExtractionPrompt } from './prompts/extraction.prompt'
import { shouldExtract } from './quality-gate.service'
import { enqueueFeedbackAiJob } from '../queues/feedback-ai-queue'
import type { ExtractionResult, RawFeedbackContent, RawFeedbackItemContextEnvelope } from '../types'
import type { RawFeedbackItemId } from '@quackback/ids'

const EXTRACTION_MODEL = 'google/gemini-2.5-flash'
const EXTRACTION_PROMPT_VERSION = 'v1'

/** Strip markdown code fences that some models wrap around JSON responses. */
function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
}

/**
 * Extract signals from a raw feedback item.
 * Called by the {feedback-ai} queue worker.
 */
export async function extractSignals(rawItemId: RawFeedbackItemId): Promise<void> {
  const openai = getOpenAI()
  if (!openai) {
    throw new UnrecoverableError('OpenAI not configured')
  }

  const item = await db.query.rawFeedbackItems.findFirst({
    where: eq(rawFeedbackItems.id, rawItemId),
  })

  if (!item) {
    throw new UnrecoverableError(`Raw item ${rawItemId} not found`)
  }

  if (item.processingState !== 'ready_for_extraction') {
    console.log(`[Extraction] Skipping ${rawItemId} in state ${item.processingState}`)
    return
  }

  await db
    .update(rawFeedbackItems)
    .set({
      processingState: 'extracting',
      stateChangedAt: new Date(),
      attemptCount: sql`${rawFeedbackItems.attemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(rawFeedbackItems.id, rawItemId))

  try {
    const content = item.content as RawFeedbackContent
    const context = (item.contextEnvelope ?? {}) as RawFeedbackItemContextEnvelope

    // Quality gate: cheap LLM pre-classifier decides if content is actionable
    const gate = await shouldExtract({
      sourceType: item.sourceType,
      content,
      context,
    })
    if (!gate.extract) {
      console.log(`[Extraction] Quality gate filtered ${rawItemId}: ${gate.reason}`)
      await db
        .update(rawFeedbackItems)
        .set({
          processingState: 'completed',
          stateChangedAt: new Date(),
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(rawFeedbackItems.id, rawItemId))
      return
    }

    const prompt = buildExtractionPrompt({
      sourceType: item.sourceType,
      content,
      context,
    })

    const completion = await withRetry(() =>
      openai.chat.completions.create({
        model: EXTRACTION_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_completion_tokens: 2000,
      })
    )

    const responseText = completion.choices[0]?.message?.content
    if (!responseText) {
      throw new UnrecoverableError('Empty response from extraction model')
    }

    let result: ExtractionResult
    try {
      result = JSON.parse(stripCodeFences(responseText))
    } catch {
      throw new UnrecoverableError(`Failed to parse extraction JSON: ${responseText.slice(0, 200)}`)
    }

    if (!result.signals || !Array.isArray(result.signals)) {
      throw new UnrecoverableError('Extraction result missing signals array')
    }

    result.signals = result.signals
      .filter((s) => (typeof s.confidence === 'number' ? s.confidence >= 0.5 : true))
      .slice(0, 5)

    await db.delete(feedbackSignals).where(eq(feedbackSignals.rawFeedbackItemId, rawItemId))

    const signalIds: string[] = []
    if (result.signals.length > 0) {
      const inserted = await db
        .insert(feedbackSignals)
        .values(
          result.signals.map((s) => ({
            rawFeedbackItemId: rawItemId,
            signalType: s.signalType,
            summary: s.summary,
            evidence: s.evidence,
            implicitNeed: s.implicitNeed,
            extractionConfidence:
              typeof s.confidence === 'number' && !Number.isNaN(s.confidence)
                ? Math.max(0, Math.min(1, s.confidence))
                : 0.5,
            processingState: 'pending_interpretation' as const,
            extractionModel: EXTRACTION_MODEL,
            extractionPromptVersion: EXTRACTION_PROMPT_VERSION,
          }))
        )
        .returning({ id: feedbackSignals.id })

      signalIds.push(...inserted.map((r) => r.id))
    }

    await db
      .update(rawFeedbackItems)
      .set({
        processingState: 'interpreting',
        stateChangedAt: new Date(),
        extractionInputTokens: completion.usage?.prompt_tokens ?? null,
        extractionOutputTokens: completion.usage?.completion_tokens ?? null,
        updatedAt: new Date(),
      })
      .where(eq(rawFeedbackItems.id, rawItemId))

    for (const signalId of signalIds) {
      await enqueueFeedbackAiJob({ type: 'interpret-signal', signalId })
    }

    if (signalIds.length === 0) {
      await db
        .update(rawFeedbackItems)
        .set({
          processingState: 'completed',
          stateChangedAt: new Date(),
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(rawFeedbackItems.id, rawItemId))
    }

    console.log(`[Extraction] Extracted ${signalIds.length} signals from ${rawItemId}`)
  } catch (error) {
    await db
      .update(rawFeedbackItems)
      .set({
        processingState: 'failed',
        stateChangedAt: new Date(),
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(rawFeedbackItems.id, rawItemId))

    throw error
  }
}

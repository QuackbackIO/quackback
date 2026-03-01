/**
 * Quality gate — cheap LLM pre-classifier for raw feedback items.
 *
 * Decides whether content is actionable product feedback before
 * spending tokens on the full extraction model. Uses a tiered approach:
 *
 * 1. Hard skip: trivially empty content (< 5 words)
 * 2. Auto-pass: high-intent sources (quackback, api) with 15+ words
 * 3. LLM gate: everything else gets a cheap model call
 */

import { getOpenAI } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
import { stripCodeFences } from '@/lib/server/domains/ai/parse'
import { buildQualityGatePrompt } from './prompts/quality-gate.prompt'
import type { RawFeedbackContent, RawFeedbackItemContextEnvelope } from '../types'

const QUALITY_GATE_MODEL = 'google/gemini-2.5-flash-lite'

/** Sources where users intentionally submit feedback — high baseline intent. */
const HIGH_INTENT_SOURCES = new Set(['api', 'quackback'])

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 1).length
}

export async function shouldExtract(item: {
  sourceType: string
  content: RawFeedbackContent
  context: RawFeedbackItemContextEnvelope
}): Promise<{ extract: boolean; reason: string }> {
  const combinedText = [item.content.subject, item.content.text].filter(Boolean).join(' ')
  const words = wordCount(combinedText)

  // Tier 1: Hard skip — trivially empty content
  if (words < 5) {
    return { extract: false, reason: `insufficient content (${words} words)` }
  }

  // Tier 2: Auto-pass — high-intent sources with enough substance
  if (HIGH_INTENT_SOURCES.has(item.sourceType) && words >= 15) {
    return { extract: true, reason: 'high-intent source with sufficient content' }
  }

  // Tier 3: LLM gate
  const openai = getOpenAI()
  if (!openai) {
    // AI not configured — fall back to permissive behavior
    return { extract: words >= 15, reason: 'AI not configured, falling back to word count' }
  }

  try {
    const prompt = buildQualityGatePrompt(item)

    const completion = await withRetry(
      () =>
        openai.chat.completions.create({
          model: QUALITY_GATE_MODEL,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 100,
        }),
      { maxRetries: 2, baseDelayMs: 500 }
    )

    const responseText = completion.choices[0]?.message?.content
    if (!responseText) {
      // Empty response — err on the side of extraction
      return { extract: true, reason: 'quality gate returned empty response' }
    }

    const result = JSON.parse(stripCodeFences(responseText)) as {
      extract?: boolean
      reason?: string
    }

    return {
      extract: result.extract !== false,
      reason: result.reason ?? 'no reason provided',
    }
  } catch (error) {
    // Quality gate failure should never block the pipeline — pass through
    console.warn(
      `[QualityGate] LLM call failed, passing through: ${error instanceof Error ? error.message : String(error)}`
    )
    return { extract: true, reason: 'quality gate error, passing through' }
  }
}

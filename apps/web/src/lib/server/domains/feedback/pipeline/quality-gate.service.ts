/**
 * Quality gate — cheap LLM pre-classifier for raw feedback items.
 *
 * Decides whether content is actionable product feedback before
 * spending tokens on the full extraction model. Uses a tiered approach:
 *
 * 1. Hard skip: trivially empty content (< 5 words)
 * 2. Auto-pass: high-intent sources (quackback, api, slack shortcut) with 15+ words
 * 3. LLM gate: everything else gets a cheap model call
 *
 * For channel-monitored items, the LLM gate also generates a suggested title
 * since there is no human-provided one.
 */

import { getOpenAI, stripCodeFences } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
import { withUsageLogging } from '@/lib/server/domains/ai/usage-log'
import { buildQualityGatePrompt } from './prompts/quality-gate.prompt'
import type { RawFeedbackContent, RawFeedbackItemContextEnvelope } from '../types'

const QUALITY_GATE_MODEL = 'google/gemini-3.1-flash-lite-preview'

/** Sources where users intentionally submit feedback — high baseline intent. */
const HIGH_INTENT_SOURCES = new Set(['api', 'quackback'])

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 1).length
}

function getIngestionMode(context: RawFeedbackItemContextEnvelope): string | undefined {
  return (context.metadata as Record<string, unknown> | undefined)?.ingestionMode as
    | string
    | undefined
}

function isHighIntent(item: {
  sourceType: string
  context: RawFeedbackItemContextEnvelope
}): boolean {
  if (HIGH_INTENT_SOURCES.has(item.sourceType)) return true
  // Slack shortcut = human-curated, high trust
  if (item.sourceType === 'slack' && getIngestionMode(item.context) === 'shortcut') return true
  return false
}

export interface QualityGateResult {
  extract: boolean
  reason: string
  /** Which tier decided: 1 = hard skip, 2 = auto-pass, 3 = LLM gate */
  tier: 1 | 2 | 3
  /** AI-generated title for channel-monitored items that pass the gate. */
  suggestedTitle?: string
}

export async function shouldExtract(item: {
  sourceType: string
  content: RawFeedbackContent
  context: RawFeedbackItemContextEnvelope
  rawFeedbackItemId?: string
}): Promise<QualityGateResult> {
  const combinedText = [item.content.subject, item.content.text].filter(Boolean).join(' ')
  const words = wordCount(combinedText)

  // Tier 1: Hard skip — trivially empty content
  if (words < 5) {
    return { extract: false, tier: 1, reason: `insufficient content (${words} words)` }
  }

  // Tier 2: Auto-pass — high-intent sources with enough substance
  if (isHighIntent(item) && words >= 15) {
    return { extract: true, tier: 2, reason: 'high-intent source with sufficient content' }
  }

  // Tier 3: LLM gate
  const openai = getOpenAI()
  if (!openai) {
    // AI not configured — fall back to permissive behavior
    return {
      extract: words >= 15,
      tier: 3,
      reason: 'AI not configured, falling back to word count',
    }
  }

  const isChannelMonitor = getIngestionMode(item.context) === 'channel_monitor'

  try {
    const prompt = buildQualityGatePrompt(item)

    const completion = await withUsageLogging(
      {
        pipelineStep: 'quality_gate',
        callType: 'chat_completion',
        model: QUALITY_GATE_MODEL,
        rawFeedbackItemId: item.rawFeedbackItemId,
        metadata: { promptVersion: 'v1', isChannelMonitor, temperature: 0 },
      },
      () =>
        withRetry(
          () =>
            openai.chat.completions.create({
              model: QUALITY_GATE_MODEL,
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' },
              temperature: 0,
              max_tokens: isChannelMonitor ? 200 : 100,
            }),
          { maxRetries: 2, baseDelayMs: 500 }
        ),
      (r) => ({
        inputTokens: r.usage?.prompt_tokens ?? 0,
        outputTokens: r.usage?.completion_tokens,
        totalTokens: r.usage?.total_tokens ?? 0,
      })
    )

    const responseText = completion.choices[0]?.message?.content
    if (!responseText) {
      return { extract: true, tier: 3, reason: 'quality gate returned empty response' }
    }

    const result = JSON.parse(stripCodeFences(responseText)) as {
      extract?: boolean
      reason?: string
      suggestedTitle?: string
    }

    return {
      extract: result.extract !== false,
      tier: 3,
      reason: result.reason ?? 'no reason provided',
      suggestedTitle: result.suggestedTitle,
    }
  } catch (error) {
    // Quality gate failure should never block the pipeline — pass through
    console.warn(
      `[QualityGate] LLM call failed, passing through: ${error instanceof Error ? error.message : String(error)}`
    )
    return { extract: true, tier: 3, reason: 'quality gate error, passing through' }
  }
}

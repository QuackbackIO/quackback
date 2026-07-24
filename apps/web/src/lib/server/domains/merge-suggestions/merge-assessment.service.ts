/**
 * Merge assessment service — LLM verification of merge candidates.
 *
 * Single batched LLM call to verify true duplicates and determine merge direction.
 */

import { chat } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { z } from 'zod'
import { config } from '@/lib/server/config'
import {
  isAiClientConfigured,
  structuredOutputProviderOptions,
} from '@/lib/server/domains/ai/config'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { logger } from '@/lib/server/logger'
import type { PostId } from '@quackback/ids'
import { truncate } from '@/lib/shared/utils/string'
import type { MergeCandidate } from './merge-search.service'

const log = logger.child({ component: 'merge-assessment' })

/**
 * `chat({ outputSchema })` collapses "empty response", "response wasn't
 * valid JSON", and "response didn't match the schema" into one thrown
 * `Error` tagged with one of these `code`s (see @tanstack/ai's
 * `finalizationError` handling) — the structured-output analogue of this
 * service's old empty-response / JSON.parse-failure branches, both of which
 * logged and returned `[]` rather than throwing. A transport/network
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

const SYSTEM_PROMPT = `You are a duplicate-detection assistant for a customer feedback platform used by product managers.
You will be given a reference post and one or more posts to compare. For each comparison post, determine whether it is truly a DUPLICATE of the reference — meaning they request the exact same thing, just worded differently.

Return strict JSON only:
{
  "results": [
    {
      "candidatePostId": "string",
      "isDuplicate": boolean,
      "confidence": number,
      "reasoning": "string"
    }
  ]
}

Rules:
- A TRUE duplicate means the posts request the EXACT SAME feature, fix, or change. If merged into one post, every voter on both posts would agree they wanted the same thing.
- "confidence" is 0-1 where 1 means certain duplicate.
- "reasoning" is a 1-sentence summary shown to product managers. Describe the shared customer need — e.g. "Both request the ability to export data as PDF." NEVER use labels like "source post", "candidate post", "Post A", "Post B", or "reference post". Just describe what the posts have in common.
- Be VERY conservative: when in doubt, mark isDuplicate as false.
- NOT duplicates: posts about the same product/area but different features, posts with overlapping keywords but different actual requests, posts that are merely related or in the same category.
- Example: "Add dark mode to the dashboard" and "Support dark theme across the app" ARE duplicates (same request). "Add dark mode" and "Improve dashboard loading speed" are NOT (same area, different requests).

Example output (one entry per comparison post, "candidatePostId" copied verbatim from its listed id):
{
  "results": [
    {
      "candidatePostId": "post_01h4kxt2e8z9y3b1n72k9q5m8p",
      "isDuplicate": true,
      "confidence": 0.9,
      "reasoning": "Both request the ability to export data as PDF."
    }
  ]
}`

interface PostInfo {
  id: PostId
  title: string
  content: string
}

export interface MergeAssessment {
  candidatePostId: PostId
  confidence: number
  reasoning: string
}

const CONFIDENCE_THRESHOLD = 0.75

// Item fields are intentionally loose (not typed/required) rather than a
// strict `z.object`: the old code tolerated individual malformed items by
// skipping just that item (the typeof guards in the filter loop below), and
// a strict per-item schema would instead fail the WHOLE batched response —
// and thus the whole `chat()` call — over one bad item. `results` itself
// gets `.catch([])` so a present-but-wrong-shaped `results` field degrades
// to "no assessments" rather than failing the request; a genuinely missing
// or non-object top level (e.g. a bare array, which older prompts/providers
// could still emit) is treated as a parse failure by the catch in
// `assessMergeCandidates`, matching the old code's parse-fail → `[]` branch.
const MergeAssessmentResponseSchema = z.object({
  results: z.array(z.record(z.string(), z.unknown())).catch([]),
})

/**
 * Assess merge candidates using LLM verification.
 * Returns only confirmed duplicates above confidence threshold.
 */
export async function assessMergeCandidates(
  sourcePost: PostInfo,
  candidates: MergeCandidate[],
  model: string
): Promise<MergeAssessment[]> {
  await enforceAiTokenBudget()

  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) || candidates.length === 0)
    return []

  const userPrompt = buildPrompt(sourcePost, candidates)

  let object: z.infer<typeof MergeAssessmentResponseSchema>
  try {
    object = await chat({
      adapter: openaiCompatibleText(model, {
        baseURL: config.openaiBaseUrl!,
        apiKey: config.openaiApiKey!,
      }),
      systemPrompts: [SYSTEM_PROMPT],
      messages: [{ role: 'user', content: userPrompt }],
      outputSchema: MergeAssessmentResponseSchema,
      stream: false,
      modelOptions: { max_tokens: 1000, ...structuredOutputProviderOptions() },
    })
  } catch (err) {
    if (!isStructuredOutputError(err)) throw err
    log.error({ err }, 'failed to parse llm json')
    return []
  }

  const assessments: MergeAssessment[] = []
  for (const item of object.results) {
    const r = item as Record<string, unknown>
    if (
      r.isDuplicate === true &&
      typeof r.confidence === 'number' &&
      r.confidence >= CONFIDENCE_THRESHOLD &&
      typeof r.candidatePostId === 'string'
    ) {
      assessments.push({
        candidatePostId: r.candidatePostId as PostId,
        confidence: r.confidence,
        reasoning: typeof r.reasoning === 'string' ? r.reasoning : '',
      })
    }
  }

  return assessments
}

/**
 * Determine which post should be the source (merged away) and which the target (kept).
 * Higher engagement → target. Older → target as tiebreak.
 */
export function determineDirection(
  postA: { id: PostId; voteCount: number; commentCount: number; createdAt: Date },
  postB: { id: PostId; voteCount: number; commentCount: number; createdAt: Date }
): { sourcePostId: PostId; targetPostId: PostId } {
  // Higher voteCount → target (keep)
  if (postA.voteCount !== postB.voteCount) {
    return postA.voteCount > postB.voteCount
      ? { sourcePostId: postB.id, targetPostId: postA.id }
      : { sourcePostId: postA.id, targetPostId: postB.id }
  }

  // Tiebreak: higher commentCount → target
  if (postA.commentCount !== postB.commentCount) {
    return postA.commentCount > postB.commentCount
      ? { sourcePostId: postB.id, targetPostId: postA.id }
      : { sourcePostId: postA.id, targetPostId: postB.id }
  }

  // Tiebreak: older createdAt → target
  return postA.createdAt <= postB.createdAt
    ? { sourcePostId: postB.id, targetPostId: postA.id }
    : { sourcePostId: postA.id, targetPostId: postB.id }
}

function buildPrompt(sourcePost: PostInfo, candidates: MergeCandidate[]): string {
  let prompt = `## Post A\nID: ${sourcePost.id}\nTitle: ${sourcePost.title}\nContent: ${truncate(sourcePost.content, 2000)}\n\n## Posts to compare\n`

  for (const c of candidates) {
    prompt += `\n### Post B\nID: ${c.postId}\nTitle: ${c.title}\nContent: ${truncate(c.content, 2000)}\n`
  }

  return prompt
}

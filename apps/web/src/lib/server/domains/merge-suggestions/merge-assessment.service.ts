/**
 * Merge assessment service — LLM verification of merge candidates.
 *
 * Single batched LLM call to verify true duplicates and determine merge direction.
 */

import { getOpenAI } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
import { stripCodeFences } from '@/lib/server/domains/ai/parse'
import type { PostId } from '@quackback/ids'
import type { MergeCandidate } from './merge-search.service'

const ASSESSMENT_MODEL = 'google/gemini-2.5-flash'

const SYSTEM_PROMPT = `You are a duplicate-detection assistant for a customer feedback platform.
You will be given a source post and a list of candidate posts. For each candidate, determine whether it is truly a DUPLICATE — meaning they request the exact same thing, just worded differently.

Return strict JSON only — an array of objects:
[
  {
    "candidatePostId": "string",
    "isDuplicate": boolean,
    "confidence": number,
    "reasoning": "string"
  }
]

Rules:
- A TRUE duplicate means the posts request the EXACT SAME feature, fix, or change. If merged into one post, every voter on both posts would agree they wanted the same thing.
- "confidence" is 0-1 where 1 means certain duplicate.
- "reasoning" should be 1 sentence explaining your determination.
- Be VERY conservative: when in doubt, mark isDuplicate as false.
- NOT duplicates: posts about the same product/area but different features, posts with overlapping keywords but different actual requests, posts that are merely related or in the same category.
- Example: "Add Amazon Japan marketplace" and "Amazon Japan integration" ARE duplicates (same request). "Add Amazon Japan" and "Simplified Amazon Upload" are NOT (different features on the same platform).`

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

/**
 * Assess merge candidates using LLM verification.
 * Returns only confirmed duplicates above confidence threshold.
 */
export async function assessMergeCandidates(
  sourcePost: PostInfo,
  candidates: MergeCandidate[]
): Promise<MergeAssessment[]> {
  const openai = getOpenAI()
  if (!openai || candidates.length === 0) return []

  const userPrompt = buildPrompt(sourcePost, candidates)

  const completion = await withRetry(() =>
    openai.chat.completions.create({
      model: ASSESSMENT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_completion_tokens: 1000,
    })
  )

  const responseText = completion.choices[0]?.message?.content
  if (!responseText) {
    console.error('[MergeSuggestion] Empty LLM response')
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFences(responseText))
  } catch {
    console.error(`[MergeSuggestion] Failed to parse LLM JSON: ${responseText.slice(0, 200)}`)
    return []
  }

  // Handle both array and { results: [...] } shapes
  const results = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.results)
      ? (parsed as { results: unknown[] }).results
      : []

  const assessments: MergeAssessment[] = []
  for (const item of results) {
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

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

function buildPrompt(sourcePost: PostInfo, candidates: MergeCandidate[]): string {
  let prompt = `## Source Post\nID: ${sourcePost.id}\nTitle: ${sourcePost.title}\nContent: ${truncate(sourcePost.content, 2000)}\n\n## Candidates\n`

  for (const c of candidates) {
    prompt += `\n### Candidate\nID: ${c.postId}\nTitle: ${c.title}\nContent: ${truncate(c.content, 2000)}\n`
  }

  return prompt
}

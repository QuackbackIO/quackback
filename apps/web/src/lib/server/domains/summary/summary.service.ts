/**
 * Post summary service.
 *
 * Generates AI-powered structured summaries of posts and their comment threads.
 * Summaries include a prose overview, key themes, and actionable suggestions.
 */

import { db, posts, comments, eq, and, or, isNull, ne, desc, sql } from '@/lib/server/db'
import { getOpenAI, isAIEnabled } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
import type { PostId } from '@quackback/ids'

const SUMMARY_MODEL = 'google/gemini-2.5-flash'

const SYSTEM_PROMPT = `You are a product feedback analyst. Summarize this post and its comment thread for a product team member.

Return JSON with:
- "summary": 1-3 sentence overview of the feedback and discussion
- "suggestions": array of 0-3 notable actionable suggestions from commenters (omit if none)

Be concise and focus on what matters for product decisions.`

/** Strip markdown code fences that some models wrap around JSON responses. */
function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
}

interface PostSummaryJson {
  summary: string
  suggestions: string[]
}

/**
 * Generate and save an AI summary for a post.
 * Fetches the post title, content, and comments, then calls the LLM.
 */
export async function generateAndSavePostSummary(postId: PostId): Promise<void> {
  if (!isAIEnabled()) return

  const openai = getOpenAI()
  if (!openai) return

  // Fetch post (include existing summary for continuity on updates)
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    columns: { title: true, content: true, commentCount: true, summaryJson: true },
  })
  if (!post) {
    console.warn(`[Summary] Post ${postId} not found`)
    return
  }

  // Fetch comments (lightweight: just content and author name)
  const postComments = await db
    .select({
      content: comments.content,
      isTeamMember: comments.isTeamMember,
    })
    .from(comments)
    .where(and(eq(comments.postId, postId), isNull(comments.deletedAt)))
    .orderBy(comments.createdAt)

  // Build prompt input
  let input = `# ${post.title}\n\n${post.content}`

  if (postComments.length > 0) {
    input += '\n\n## Comments\n'
    for (const c of postComments) {
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
      '\n\nA previous summary is included. Update it to reflect the current state of the discussion — preserve existing themes and suggestions that are still relevant, and incorporate any new information from recent comments.'
    : SYSTEM_PROMPT

  const completion = await withRetry(() =>
    openai.chat.completions.create({
      model: SUMMARY_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_completion_tokens: 1000,
    })
  )

  const responseText = completion.choices[0]?.message?.content
  if (!responseText) {
    console.error(`[Summary] Empty response for post ${postId}`)
    return
  }

  let summaryJson: PostSummaryJson
  try {
    summaryJson = JSON.parse(stripCodeFences(responseText))
  } catch {
    console.error(
      `[Summary] Failed to parse JSON for post ${postId}: ${responseText.slice(0, 200)}`
    )
    return
  }

  // Validate shape
  if (typeof summaryJson.summary !== 'string') {
    console.error(`[Summary] Invalid summary shape for post ${postId}`)
    return
  }

  if (!Array.isArray(summaryJson.suggestions)) {
    summaryJson.suggestions = []
  }

  await db
    .update(posts)
    .set({
      summaryJson,
      summaryModel: SUMMARY_MODEL,
      summaryUpdatedAt: new Date(),
      summaryCommentCount: post.commentCount,
    })
    .where(eq(posts.id, postId))

  console.log(`[Summary] Generated for post ${postId} (${postComments.length} comments)`)
}

const SWEEP_BATCH_SIZE = 50
const SWEEP_BATCH_DELAY_MS = 500

/**
 * Refresh stale summaries.
 * Finds all posts where the summary is missing or the comment count has changed,
 * and processes them in batches until none remain.
 */
export async function refreshStaleSummaries(): Promise<void> {
  if (!isAIEnabled()) return

  let totalProcessed = 0
  let totalFailed = 0

  // Process in batches until no stale posts remain
  while (true) {
    const stalePosts = await db
      .select({ id: posts.id })
      .from(posts)
      .where(
        and(
          isNull(posts.deletedAt),
          or(isNull(posts.summaryJson), ne(posts.summaryCommentCount, posts.commentCount))
        )
      )
      .orderBy(desc(posts.updatedAt))
      .limit(SWEEP_BATCH_SIZE)

    if (stalePosts.length === 0) break

    if (totalProcessed === 0) {
      // Count total on first batch for logging
      const [{ count: totalStale }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(posts)
        .where(
          and(
            isNull(posts.deletedAt),
            or(isNull(posts.summaryJson), ne(posts.summaryCommentCount, posts.commentCount))
          )
        )
      console.log(`[Summary] Found ${totalStale} stale posts, processing...`)
    }

    for (const { id } of stalePosts) {
      try {
        await generateAndSavePostSummary(id)
        totalProcessed++
      } catch (err) {
        totalFailed++
        console.error(`[Summary] Failed to refresh post ${id}:`, err)
      }
    }

    console.log(`[Summary] Progress: ${totalProcessed} processed, ${totalFailed} failed`)

    // Brief pause between batches to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, SWEEP_BATCH_DELAY_MS))
  }

  if (totalProcessed > 0) {
    console.log(`[Summary] Sweep complete: ${totalProcessed} processed, ${totalFailed} failed`)
  }
}

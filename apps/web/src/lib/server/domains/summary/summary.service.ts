/**
 * Post summary service.
 *
 * Generates AI-powered structured summaries of posts and their comment threads.
 * Summaries include a prose overview, key themes, and actionable suggestions.
 */

import { db, posts, comments, eq, and, or, isNull, ne, desc } from '@/lib/server/db'
import { getOpenAI, isAIEnabled } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
import type { PostId } from '@quackback/ids'

const SUMMARY_MODEL = 'google/gemini-2.5-flash'

const SYSTEM_PROMPT = `You are a product feedback analyst. Summarize this post and its comment thread for a product team member.

Return JSON with:
- "summary": 1-3 sentence overview of the feedback and discussion
- "themes": array of 2-5 short theme labels (2-4 words each) representing key topics
- "suggestions": array of 0-3 notable actionable suggestions from commenters (omit if none)

Be concise and focus on what matters for product decisions.`

/** Strip markdown code fences that some models wrap around JSON responses. */
function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
}

interface PostSummaryJson {
  summary: string
  themes: string[]
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

  // Fetch post
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    columns: { title: true, content: true, commentCount: true },
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

  // Truncate to ~6000 chars to stay within token limits
  if (input.length > 6000) {
    input = input.slice(0, 6000) + '\n\n[truncated]'
  }

  const completion = await withRetry(() =>
    openai.chat.completions.create({
      model: SUMMARY_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
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
  if (typeof summaryJson.summary !== 'string' || !Array.isArray(summaryJson.themes)) {
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

/**
 * Refresh stale summaries.
 * Finds posts where the summary is missing or the comment count has changed.
 * Processes up to 10 per sweep.
 */
export async function refreshStaleSummaries(): Promise<void> {
  if (!isAIEnabled()) return

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
    .limit(10)

  if (stalePosts.length === 0) return

  console.log(`[Summary] Refreshing ${stalePosts.length} stale summaries`)

  for (const { id } of stalePosts) {
    try {
      await generateAndSavePostSummary(id)
    } catch (err) {
      console.error(`[Summary] Failed to refresh post ${id}:`, err)
    }
  }
}

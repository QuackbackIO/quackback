/**
 * Post summary service.
 *
 * Generates AI-powered structured summaries of posts and their comment threads.
 * Summaries include a prose overview, urgency level, key quotes, and next steps.
 */

import { db, posts, comments, eq, and, or, isNull, ne, desc, sql } from '@/lib/server/db'
import { getOpenAI } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
import { stripCodeFences } from '@/lib/server/domains/ai/parse'
import type { PostId } from '@quackback/ids'

const SUMMARY_MODEL = 'google/gemini-2.5-flash'

const SYSTEM_PROMPT = `You are a product feedback analyst writing post briefs for a PM's triage queue.
Your job is to surface what matters for prioritization, not restate the obvious.

Return strict JSON only:
{
  "summary": "string",
  "keyQuotes": ["string"],
  "nextSteps": ["string"]
}

Rules for "summary" (1-3 sentences):
- Lead with the core user need or problem, not "Users are requesting X."
- Name specifics: what feature, what workflow, what breaks.
- If comments add context beyond the original post, synthesize it.
- If there is disagreement or pushback in the thread, note the tension.
- Write for a PM who has 5 seconds to decide whether to dig deeper.
- BAD: "Users are requesting improvements to the export functionality."
- GOOD: "CSV exports silently drop columns with special characters, affecting 3 users doing financial reporting. Team acknowledged but no fix timeline given."

Rules for "keyQuotes" (0-2):
- Only quote user/customer text, never team replies.
- Pick quotes that capture the emotional or factual core.
- Keep each under 120 characters. Truncate with "..." if needed.
- Omit if the post body alone is sufficient.

Rules for "nextSteps" (0-2):
- Start each with a verb: "Investigate...", "Reproduce...", "Respond to..."
- Only include when the discussion has enough specificity for a real action.
- Never include generic advice like "Consider user feedback."`

interface PostSummaryJson {
  summary: string
  keyQuotes: string[]
  nextSteps: string[]
}

/**
 * Generate and save an AI summary for a post.
 * Fetches the post title, content, and comments, then calls the LLM.
 */
export async function generateAndSavePostSummary(postId: PostId): Promise<void> {
  const openai = getOpenAI()
  if (!openai) return

  // Fetch post (include existing summary for continuity on updates)
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    columns: { title: true, content: true, summaryJson: true },
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
      '\n\nA previous summary is included. Update it to reflect the current state of the discussion — preserve existing context that is still relevant, and incorporate any new information from recent comments.'
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

  // Coerce arrays
  if (!Array.isArray(summaryJson.keyQuotes)) {
    summaryJson.keyQuotes = []
  }
  if (!Array.isArray(summaryJson.nextSteps)) {
    summaryJson.nextSteps = []
  }

  await db
    .update(posts)
    .set({
      summaryJson,
      summaryModel: SUMMARY_MODEL,
      summaryUpdatedAt: new Date(),
      summaryCommentCount: postComments.length,
    })
    .where(eq(posts.id, postId))

  console.log(`[Summary] Generated for post ${postId} (${postComments.length} comments)`)
}

const SWEEP_BATCH_SIZE = 50
const SWEEP_BATCH_DELAY_MS = 500

/** Subquery: live comment count per post (non-deleted comments only). */
const liveCommentCountSq = db
  .select({
    postId: comments.postId,
    count: sql<number>`count(*)::int`.as('live_count'),
  })
  .from(comments)
  .where(isNull(comments.deletedAt))
  .groupBy(comments.postId)
  .as('live_cc')

/**
 * Refresh stale summaries.
 * Finds all posts where the summary is missing or the live comment count has changed,
 * and processes them in batches until none remain.
 */
export async function refreshStaleSummaries(): Promise<void> {
  if (!getOpenAI()) return

  let totalProcessed = 0
  let totalFailed = 0

  // Process in batches until no stale posts remain
  while (true) {
    const stalePosts = await db
      .select({ id: posts.id })
      .from(posts)
      .leftJoin(liveCommentCountSq, eq(posts.id, liveCommentCountSq.postId))
      .where(
        and(
          isNull(posts.deletedAt),
          or(
            isNull(posts.summaryJson),
            ne(posts.summaryCommentCount, sql`coalesce(${liveCommentCountSq.count}, 0)`)
          )
        )
      )
      .orderBy(desc(posts.updatedAt))
      .limit(SWEEP_BATCH_SIZE)

    if (stalePosts.length === 0) break

    if (totalProcessed === 0) {
      console.log(`[Summary] Found stale posts, processing...`)
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

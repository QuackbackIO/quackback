/**
 * Sentiment analysis service.
 *
 * Analyzes customer feedback to classify sentiment as positive, neutral, or negative.
 * Uses the configured chat model via the configured provider or gateway endpoint.
 */

import { db, postSentiment, posts, eq, and, gte, lte, sql, count, isNull } from '@/lib/server/db'
import { createId, type PostId } from '@quackback/ids'
import { getOpenAI } from '@/lib/server/domains/ai/config'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { withRetry } from '@/lib/server/domains/ai/retry'
import { withUsageLogging } from '@/lib/server/domains/ai/usage-log'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'sentiment' })

export type Sentiment = 'positive' | 'neutral' | 'negative'

export interface SentimentResult {
  sentiment: Sentiment
  confidence: number
  model: string
  inputTokens?: number
  outputTokens?: number
}

export interface SentimentBreakdown {
  positive: number
  neutral: number
  negative: number
  total: number
}

export interface SentimentTrendPoint {
  date: string
  positive: number
  neutral: number
  negative: number
}

export interface PostForSentiment {
  id: PostId
  title: string
  content: string
}

const SENTIMENT_PROMPT = `Classify the sentiment of this customer feedback as positive, neutral, or negative.
- positive: Happy, satisfied, praising, appreciative
- neutral: Factual request, question, neutral information
- negative: Frustrated, complaining, reporting issues

Respond with only JSON: {"sentiment": "positive" | "neutral" | "negative", "confidence": 0.0-1.0}`

const VALID_SENTIMENTS: Sentiment[] = ['positive', 'neutral', 'negative']
const MAX_CONTENT_LENGTH = 3000

function isValidSentiment(value: unknown): value is Sentiment {
  return typeof value === 'string' && VALID_SENTIMENTS.includes(value as Sentiment)
}

/**
 * Analyze sentiment using the configured chat model.
 */
export async function analyzeSentiment(
  title: string,
  content: string,
  postId?: string
): Promise<SentimentResult | null> {
  await enforceAiTokenBudget()

  const openai = getOpenAI()
  const model = getChatModel('sentiment')
  if (!openai || !model) return null

  const truncatedContent = (content || '(no content)').slice(0, MAX_CONTENT_LENGTH)
  const text = `Title: ${title}\n\nContent: ${truncatedContent}`

  try {
    const response = await withUsageLogging(
      {
        pipelineStep: 'sentiment',
        callType: 'chat_completion',
        model,
        postId,
      },
      () =>
        withRetry(() =>
          openai.chat.completions.create({
            model,
            max_completion_tokens: 1000,
            messages: [
              { role: 'system', content: SENTIMENT_PROMPT },
              { role: 'user', content: text },
            ],
            response_format: { type: 'json_object' },
          })
        ),
      (r) => ({
        inputTokens: r.usage?.prompt_tokens ?? 0,
        outputTokens: r.usage?.completion_tokens,
        totalTokens: r.usage?.total_tokens ?? 0,
      })
    )
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}')

    if (!isValidSentiment(parsed.sentiment) || typeof parsed.confidence !== 'number') {
      log.error({ model_response: parsed }, 'invalid sentiment model response')
      return null
    }

    return {
      sentiment: parsed.sentiment,
      confidence: parsed.confidence,
      model,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    }
  } catch (error) {
    log.error({ err: error }, 'sentiment generation failed')
    return null
  }
}

/**
 * Save sentiment analysis result to database.
 */
export async function saveSentiment(postId: PostId, result: SentimentResult): Promise<void> {
  await db
    .insert(postSentiment)
    .values({
      id: createId('sentiment'),
      postId,
      sentiment: result.sentiment,
      confidence: result.confidence,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    })
    .onConflictDoUpdate({
      target: postSentiment.postId,
      set: {
        sentiment: result.sentiment,
        confidence: result.confidence,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        processedAt: new Date(),
      },
    })
}

/**
 * Get sentiment for a specific post.
 */
export async function getSentiment(postId: PostId) {
  return db.query.postSentiment.findFirst({
    where: eq(postSentiment.postId, postId),
  })
}

/**
 * Get sentiment breakdown for a date range.
 */
export async function getSentimentBreakdown(
  startDate: Date,
  endDate: Date
): Promise<SentimentBreakdown> {
  const results = await db
    .select({
      sentiment: postSentiment.sentiment,
      count: count(),
    })
    .from(postSentiment)
    .innerJoin(posts, eq(posts.id, postSentiment.postId))
    .where(
      and(gte(posts.createdAt, startDate), lte(posts.createdAt, endDate), isNull(posts.deletedAt))
    )
    .groupBy(postSentiment.sentiment)

  const breakdown: SentimentBreakdown = { positive: 0, neutral: 0, negative: 0, total: 0 }

  for (const row of results) {
    const sentiment = row.sentiment as Sentiment
    const countValue = Number(row.count)
    breakdown[sentiment] = countValue
    breakdown.total += countValue
  }

  return breakdown
}

/**
 * Get sentiment trend over time.
 */
export async function getSentimentTrend(
  startDate: Date,
  endDate: Date
): Promise<SentimentTrendPoint[]> {
  const results = await db
    .select({
      date: sql<string>`DATE(${posts.createdAt})`.as('date'),
      sentiment: postSentiment.sentiment,
      count: count(),
    })
    .from(postSentiment)
    .innerJoin(posts, eq(posts.id, postSentiment.postId))
    .where(
      and(gte(posts.createdAt, startDate), lte(posts.createdAt, endDate), isNull(posts.deletedAt))
    )
    .groupBy(sql`DATE(${posts.createdAt})`, postSentiment.sentiment)
    .orderBy(sql`DATE(${posts.createdAt})`)

  const trendMap = new Map<string, SentimentTrendPoint>()

  for (const row of results) {
    const existing = trendMap.get(row.date) || {
      date: row.date,
      positive: 0,
      neutral: 0,
      negative: 0,
    }
    existing[row.sentiment as Sentiment] = Number(row.count)
    trendMap.set(row.date, existing)
  }

  return Array.from(trendMap.values())
}

/**
 * Get posts without sentiment analysis.
 */
export async function getPostsWithoutSentiment(limit = 100): Promise<PostForSentiment[]> {
  return db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
    })
    .from(posts)
    .leftJoin(postSentiment, eq(postSentiment.postId, posts.id))
    .where(and(isNull(postSentiment.id), isNull(posts.deletedAt)))
    .limit(limit)
}

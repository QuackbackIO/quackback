/**
 * Sentiment analysis service.
 *
 * Analyzes customer feedback to classify sentiment as positive, neutral, or negative.
 * Uses the configured chat model via the configured provider or gateway endpoint.
 */

import { chat } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { z } from 'zod'
import { db, postSentiment, posts, eq, and, gte, lte, sql, count, isNull } from '@/lib/server/db'
import { createId, type PostId } from '@quackback/ids'
import { config } from '@/lib/server/config'
import {
  isAiClientConfigured,
  structuredOutputProviderOptions,
} from '@/lib/server/domains/ai/config'
import { createUsageLoggingMiddleware } from '@/lib/server/domains/ai/usage-middleware'
import { getChatModel } from '@/lib/server/domains/ai/models'
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

Respond with ONLY a single JSON object, no preamble or code fence: {"sentiment": "positive" | "neutral" | "negative", "confidence": 0.0-1.0}

Example output:
{"sentiment": "negative", "confidence": 0.85}`

const MAX_CONTENT_LENGTH = 3000

const SentimentSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  confidence: z.number(),
})

/**
 * Analyze sentiment using the configured chat model.
 */
export async function analyzeSentiment(
  title: string,
  content: string,
  postId?: string
): Promise<SentimentResult | null> {
  await enforceAiTokenBudget()

  const model = getChatModel('sentiment')
  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) || !model) return null

  const truncatedContent = (content || '(no content)').slice(0, MAX_CONTENT_LENGTH)
  const text = `Title: ${title}\n\nContent: ${truncatedContent}`

  try {
    const object = await chat({
      adapter: openaiCompatibleText(model, {
        baseURL: config.openaiBaseUrl!,
        apiKey: config.openaiApiKey!,
      }),
      systemPrompts: [SENTIMENT_PROMPT],
      messages: [{ role: 'user', content: text }],
      outputSchema: SentimentSchema,
      stream: false,
      modelOptions: { max_tokens: 1000, ...structuredOutputProviderOptions() },
      middleware: [
        createUsageLoggingMiddleware({
          pipelineStep: 'sentiment',
          model,
          postId,
        }),
      ],
    })

    // Per-row token counts are no longer available here: chat() with
    // outputSchema + stream:false resolves the validated object only, and
    // usage now flows through the middleware into ai_usage_log instead (the
    // aggregate accounting path). inputTokens/outputTokens stay undefined —
    // the postSentiment columns are nullable and nothing else reads them.
    return {
      sentiment: object.sentiment,
      confidence: object.confidence,
      model,
    }
  } catch (error) {
    // Covers both a malformed/non-JSON model response and a well-formed but
    // schema-invalid one (chat() throws on either with outputSchema set) —
    // both collapse to the same best-effort null the old parse-and-validate
    // branch returned.
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

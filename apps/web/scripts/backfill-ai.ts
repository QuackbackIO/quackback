#!/usr/bin/env bun
/**
 * Backfill AI features (sentiment analysis and embeddings) for existing posts.
 *
 * Usage:
 *   bun scripts/backfill-ai.ts              # Process all posts
 *   bun scripts/backfill-ai.ts --dry-run    # Preview without processing
 *   bun scripts/backfill-ai.ts --sentiment  # Only process sentiment
 *   bun scripts/backfill-ai.ts --embeddings # Only process embeddings
 *   bun scripts/backfill-ai.ts --limit=100  # Limit number of posts
 *
 * Environment:
 *   OPENAI_API_KEY     - Required. OpenAI API key.
 *   OPENAI_BASE_URL    - Optional. Custom base URL (e.g., Cloudflare AI Gateway).
 *   DATABASE_URL       - Required. PostgreSQL connection string.
 */

// Load .env if available (optional - can also pass env vars directly)
try {
  const { config } = await import('dotenv')
  config({ path: '.env', quiet: true })
} catch {
  // dotenv not available, rely on environment variables
}

import OpenAI from 'openai'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, and, isNull, sql, count } from 'drizzle-orm'
import { posts, postSentiment, postTags, tags } from '@quackback/db/schema'
import { generateId, type PostId } from '@quackback/ids'

// Configuration
const BATCH_SIZE = 10
const RATE_LIMIT_DELAY_MS = 500 // Delay between batches to avoid rate limits
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000
const MAX_FAIL_ATTEMPTS = 3 // Skip posts that fail this many times

// Track failed posts to avoid infinite retry loops
const failedSentimentPosts = new Map<string, number>() // postId -> fail count
const failedEmbeddingPosts = new Map<string, number>() // postId -> fail count

// Parse CLI arguments
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const sentimentOnly = args.includes('--sentiment')
const embeddingsOnly = args.includes('--embeddings')
const limitArg = args.find((a) => a.startsWith('--limit='))
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined

// Validate environment
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required')
  process.exit(1)
}

if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY environment variable is required')
  process.exit(1)
}

// Initialize clients
const client = postgres(process.env.DATABASE_URL)
const db = drizzle(client)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})

// Retry helper
async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let lastError: Error | undefined
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      if (i < retries - 1) {
        await sleep(RETRY_DELAY_MS * (i + 1))
      }
    }
  }
  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Sentiment analysis
const SENTIMENT_PROMPT = `Classify the sentiment of this customer feedback as positive, neutral, or negative.
- positive: Happy, satisfied, praising, appreciative
- neutral: Factual request, question, neutral information
- negative: Frustrated, complaining, reporting issues

Respond with only JSON: {"sentiment": "positive" | "neutral" | "negative", "confidence": 0.0-1.0}`

async function analyzeSentiment(
  title: string,
  content: string
): Promise<{
  sentiment: 'positive' | 'neutral' | 'negative'
  confidence: number
  inputTokens?: number
  outputTokens?: number
} | null> {
  // Truncate long content to avoid token limits (gpt-5-nano has ~4k context)
  const truncatedContent = (content || '(no content)').slice(0, 3000)
  const text = `Title: ${title}\n\nContent: ${truncatedContent}`

  try {
    // gpt-5-nano uses reasoning tokens (~200) before outputting, so we need more headroom
    const response = await withRetry(() =>
      openai.chat.completions.create({
        model: 'gpt-5-nano',
        max_completion_tokens: 1000,
        messages: [
          { role: 'system', content: SENTIMENT_PROMPT },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
      })
    )
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}')

    // Validate the response - only return if we have valid sentiment and confidence
    const validSentiments = ['positive', 'neutral', 'negative']
    if (!validSentiments.includes(parsed.sentiment) || typeof parsed.confidence !== 'number') {
      console.error('  Invalid model response:', parsed)
      return null
    }

    return {
      sentiment: parsed.sentiment,
      confidence: parsed.confidence,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    }
  } catch (error) {
    console.error('  Sentiment analysis failed:', (error as Error).message)
    return null
  }
}

// Embedding generation
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536

async function generateEmbedding(text: string): Promise<number[] | null> {
  const truncated = text.slice(0, 8000)

  try {
    const response = await withRetry(() =>
      openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: truncated,
        dimensions: EMBEDDING_DIMENSIONS,
      })
    )
    return response.data[0].embedding
  } catch (error) {
    console.error('  Embedding generation failed:', (error as Error).message)
    return null
  }
}

/**
 * Format post text for embedding, including tags for better semantic matching.
 */
function formatPostText(title: string, content: string, tagNames: string[]): string {
  const parts = [title, title, content || '']
  if (tagNames.length > 0) {
    parts.push(`Tags: ${tagNames.join(', ')}`)
  }
  return parts.join('\n\n')
}

/**
 * Fetch tag names for a post.
 */
async function getPostTagNames(postId: PostId): Promise<string[]> {
  try {
    const result = await db
      .select({ name: tags.name })
      .from(postTags)
      .innerJoin(tags, eq(postTags.tagId, tags.id))
      .where(eq(postTags.postId, postId))
    return result.map((r) => r.name)
  } catch {
    return []
  }
}

// Query helpers
async function getPostsWithoutSentiment(batchLimit: number) {
  return db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
    })
    .from(posts)
    .leftJoin(postSentiment, eq(postSentiment.postId, posts.id))
    .where(and(isNull(postSentiment.id), isNull(posts.deletedAt)))
    .limit(batchLimit)
}

async function getPostsWithoutEmbeddings(batchLimit: number) {
  return db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
    })
    .from(posts)
    .where(and(sql`${posts.embedding} IS NULL`, isNull(posts.deletedAt)))
    .limit(batchLimit)
}

async function countPostsWithoutSentiment(): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(posts)
    .leftJoin(postSentiment, eq(postSentiment.postId, posts.id))
    .where(and(isNull(postSentiment.id), isNull(posts.deletedAt)))
  return Number(result[0].count)
}

async function countPostsWithoutEmbeddings(): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(posts)
    .where(and(sql`${posts.embedding} IS NULL`, isNull(posts.deletedAt)))
  return Number(result[0].count)
}

// Save helpers
async function saveSentiment(
  postId: PostId,
  result: {
    sentiment: 'positive' | 'neutral' | 'negative'
    confidence: number
    inputTokens?: number
    outputTokens?: number
  }
): Promise<void> {
  await db
    .insert(postSentiment)
    .values({
      id: generateId('sentiment'),
      postId,
      sentiment: result.sentiment,
      confidence: result.confidence,
      model: 'gpt-5-nano',
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    })
    .onConflictDoUpdate({
      target: postSentiment.postId,
      set: {
        sentiment: result.sentiment,
        confidence: result.confidence,
        model: 'gpt-5-nano',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        processedAt: new Date(),
      },
    })
}

async function saveEmbedding(postId: PostId, embedding: number[]): Promise<void> {
  const vectorStr = `[${embedding.join(',')}]`

  await db
    .update(posts)
    .set({
      embedding: sql<number[]>`${vectorStr}::vector`,
      embeddingModel: EMBEDDING_MODEL,
      embeddingUpdatedAt: new Date(),
    })
    .where(eq(posts.id, postId))
}

// Main backfill functions
async function backfillSentiment(
  totalLimit?: number
): Promise<{ processed: number; failed: number; skipped: number }> {
  const totalToProcess = totalLimit ?? (await countPostsWithoutSentiment())
  console.log(`\n📊 Processing sentiment for ${totalToProcess} posts...`)

  let processed = 0
  let failed = 0
  let skipped = 0
  let consecutiveSkips = 0

  while (true) {
    const batch = await getPostsWithoutSentiment(BATCH_SIZE)

    if (batch.length === 0) break

    // Filter out posts that have failed too many times
    const postsToProcess = batch.filter((post) => {
      const failCount = failedSentimentPosts.get(post.id) || 0
      if (failCount >= MAX_FAIL_ATTEMPTS) {
        skipped++
        return false
      }
      return true
    })

    // If all posts in batch are skipped, we might be stuck
    if (postsToProcess.length === 0) {
      consecutiveSkips++
      if (consecutiveSkips > 5) {
        console.log(`  ⚠️ All remaining posts have failed too many times, stopping.`)
        break
      }
      await sleep(100)
      continue
    }
    consecutiveSkips = 0

    for (const post of postsToProcess) {
      if (dryRun) {
        console.log(`  [DRY RUN] Would analyze sentiment: ${post.title.substring(0, 50)}...`)
        processed++
      } else {
        const result = await analyzeSentiment(post.title, post.content || '')
        if (result) {
          await saveSentiment(post.id, result)
          console.log(
            `  ✅ ${post.title.substring(0, 40)}... → ${result.sentiment} (${(result.confidence * 100).toFixed(0)}%)`
          )
          processed++
          // Clear from failed map on success
          failedSentimentPosts.delete(post.id)
        } else {
          const failCount = (failedSentimentPosts.get(post.id) || 0) + 1
          failedSentimentPosts.set(post.id, failCount)
          if (failCount >= MAX_FAIL_ATTEMPTS) {
            console.log(`  ⏭️  ${post.title.substring(0, 40)}... → skipping (failed ${failCount}x)`)
            skipped++
          } else {
            console.log(
              `  ❌ ${post.title.substring(0, 40)}... → failed (attempt ${failCount}/${MAX_FAIL_ATTEMPTS})`
            )
          }
          failed++
        }
      }
    }

    // Progress update
    const total = processed + skipped
    if (totalLimit && total >= totalLimit) break
    console.log(`  Progress: ${processed} processed, ${failed} failed, ${skipped} skipped`)

    // Rate limit delay
    if (!dryRun) {
      await sleep(RATE_LIMIT_DELAY_MS)
    }
  }

  return { processed, failed, skipped }
}

async function backfillEmbeddings(
  totalLimit?: number
): Promise<{ processed: number; failed: number; skipped: number }> {
  const totalToProcess = totalLimit ?? (await countPostsWithoutEmbeddings())
  console.log(`\n🔢 Processing embeddings for ${totalToProcess} posts...`)

  let processed = 0
  let failed = 0
  let skipped = 0
  let consecutiveSkips = 0

  while (true) {
    const batch = await getPostsWithoutEmbeddings(BATCH_SIZE)

    if (batch.length === 0) break

    // Filter out posts that have failed too many times
    const postsToProcess = batch.filter((post) => {
      const failCount = failedEmbeddingPosts.get(post.id) || 0
      if (failCount >= MAX_FAIL_ATTEMPTS) {
        skipped++
        return false
      }
      return true
    })

    // If all posts in batch are skipped, we might be stuck
    if (postsToProcess.length === 0) {
      consecutiveSkips++
      if (consecutiveSkips > 5) {
        console.log(`  ⚠️ All remaining posts have failed too many times, stopping.`)
        break
      }
      await sleep(100)
      continue
    }
    consecutiveSkips = 0

    for (const post of postsToProcess) {
      if (dryRun) {
        console.log(`  [DRY RUN] Would generate embedding: ${post.title.substring(0, 50)}...`)
        processed++
      } else {
        // Fetch tags for this post to include in embedding
        const tagNames = await getPostTagNames(post.id)
        const text = formatPostText(post.title, post.content || '', tagNames)
        const embedding = await generateEmbedding(text)
        if (embedding) {
          await saveEmbedding(post.id, embedding)
          const tagInfo = tagNames.length > 0 ? ` [${tagNames.join(', ')}]` : ''
          console.log(`  ✅ ${post.title.substring(0, 50)}...${tagInfo}`)
          processed++
          failedEmbeddingPosts.delete(post.id)
        } else {
          const failCount = (failedEmbeddingPosts.get(post.id) || 0) + 1
          failedEmbeddingPosts.set(post.id, failCount)
          if (failCount >= MAX_FAIL_ATTEMPTS) {
            console.log(`  ⏭️  ${post.title.substring(0, 50)}... → skipping (failed ${failCount}x)`)
            skipped++
          } else {
            console.log(
              `  ❌ ${post.title.substring(0, 50)}... → failed (attempt ${failCount}/${MAX_FAIL_ATTEMPTS})`
            )
          }
          failed++
        }
      }
    }

    // Progress update
    const total = processed + skipped
    if (totalLimit && total >= totalLimit) break
    console.log(`  Progress: ${processed} processed, ${failed} failed, ${skipped} skipped`)

    // Rate limit delay
    if (!dryRun) {
      await sleep(RATE_LIMIT_DELAY_MS)
    }
  }

  return { processed, failed, skipped }
}

// Main
async function main() {
  console.log('🦆 Quackback AI Backfill\n')
  console.log('Configuration:')
  console.log(`  Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`)
  console.log(`  Sentiment: ${embeddingsOnly ? 'Skip' : 'Process'}`)
  console.log(`  Embeddings: ${sentimentOnly ? 'Skip' : 'Process'}`)
  console.log(`  Limit: ${limit ?? 'All posts'}`)
  console.log(`  OpenAI Base URL: ${process.env.OPENAI_BASE_URL || 'default'}`)

  const results: {
    sentiment?: { processed: number; failed: number; skipped: number }
    embeddings?: { processed: number; failed: number; skipped: number }
  } = {}

  // Process sentiment
  if (!embeddingsOnly) {
    results.sentiment = await backfillSentiment(limit)
  }

  // Process embeddings
  if (!sentimentOnly) {
    results.embeddings = await backfillEmbeddings(limit)
  }

  // Summary
  console.log('\n--- Summary ---')
  if (results.sentiment) {
    console.log(
      `Sentiment: ${results.sentiment.processed} processed, ${results.sentiment.failed} failed, ${results.sentiment.skipped} skipped`
    )
  }
  if (results.embeddings) {
    console.log(
      `Embeddings: ${results.embeddings.processed} processed, ${results.embeddings.failed} failed, ${results.embeddings.skipped} skipped`
    )
  }

  const totalSkipped = (results.sentiment?.skipped ?? 0) + (results.embeddings?.skipped ?? 0)
  if (totalSkipped > 0) {
    console.log(
      `\n⚠️  ${totalSkipped} posts were skipped after failing ${MAX_FAIL_ATTEMPTS} times.`
    )
  }
  console.log('\n✅ Backfill complete!')

  await client.end()
}

main().catch(async (error) => {
  console.error('Fatal error:', error)
  await client.end()
  process.exit(1)
})

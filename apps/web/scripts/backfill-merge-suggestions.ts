#!/usr/bin/env bun
/**
 * Backfill merge suggestions for existing posts.
 *
 * Runs the merge candidate detection (hybrid search + LLM verification) on all
 * posts that have embeddings but haven't been merge-checked yet.
 *
 * This is equivalent to what the periodic sweep does, but runs as a one-time
 * backfill with progress reporting and configurable limits.
 *
 * Usage:
 *   bun apps/web/scripts/backfill-merge-suggestions.ts
 *   bun apps/web/scripts/backfill-merge-suggestions.ts --dry-run
 *   bun apps/web/scripts/backfill-merge-suggestions.ts --limit=50
 *   bun apps/web/scripts/backfill-merge-suggestions.ts --force   # Re-check all posts
 *
 * Environment:
 *   OPENAI_API_KEY  - Required. OpenAI API key (routed through gateway if OPENAI_BASE_URL set).
 *   DATABASE_URL    - Required. PostgreSQL connection string.
 */

try {
  const { config } = await import('dotenv')
  config({ path: '.env', quiet: true })
} catch {
  // dotenv not available
}

import OpenAI from 'openai'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, and, or, isNull, desc, sql, count } from 'drizzle-orm'
import { posts, mergeSuggestions } from '@quackback/db/schema'
import { toUuid, type PostId } from '@quackback/ids'

// ============================================
// Configuration
// ============================================

const BATCH_SIZE = 50
const POST_DELAY_MS = 500
const VECTOR_THRESHOLD = 0.35
const HYBRID_THRESHOLD = 0.4
const FTS_WEIGHT = 0.3
const LLM_CONFIDENCE_THRESHOLD = 0.75
const CANDIDATE_LIMIT = 5
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000
const ASSESSMENT_MODEL = 'google/gemini-2.5-flash'

// Parse CLI arguments
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const limitArg = args.find((a) => a.startsWith('--limit='))
const maxPosts = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined

// Validate environment
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY environment variable is required')
  process.exit(1)
}

const client = postgres(process.env.DATABASE_URL)
const db = drizzle(client)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})

// ============================================
// Helpers
// ============================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      if (i < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (i + 1))
      }
    }
  }
  throw lastError
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

// ============================================
// Hybrid search
// ============================================

interface MergeCandidate {
  postId: PostId
  title: string
  content: string
  voteCount: number
  commentCount: number
  createdAt: Date
  vectorScore: number
  ftsScore: number
  hybridScore: number
}

async function findMergeCandidates(postId: PostId): Promise<MergeCandidate[]> {
  const sourcePost = await db
    .select({ title: posts.title, embedding: posts.embedding })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1)

  if (!sourcePost[0]?.embedding) return []

  const title = sourcePost[0].title
  // pgvector/drizzle returns embedding as string "[0.1,0.2,...]"
  const rawEmb = sourcePost[0].embedding
  const embeddingStr = typeof rawEmb === 'string' ? rawEmb : `[${(rawEmb as number[]).join(',')}]`
  const vectorStr = embeddingStr.startsWith('[') ? embeddingStr : `[${embeddingStr}]`
  const fetchLimit = CANDIDATE_LIMIT * 2

  // Use raw SQL for FTS to avoid custom type issues with standalone drizzle
  const [ftsMatches, vectorMatches] = await Promise.all([
    db
      .select({
        id: posts.id,
        title: posts.title,
        content: posts.content,
        voteCount: posts.voteCount,
        commentCount: posts.commentCount,
        createdAt: posts.createdAt,
        score: sql<number>`ts_rank(search_vector, plainto_tsquery('english', ${title}))`.as(
          'fts_score'
        ),
      })
      .from(posts)
      .where(
        and(
          isNull(posts.deletedAt),
          isNull(posts.canonicalPostId),
          sql`embedding IS NOT NULL`,
          sql`${posts.id} != ${toUuid(postId)}::uuid`,
          sql`search_vector @@ plainto_tsquery('english', ${title})`
        )
      )
      .orderBy(desc(sql`ts_rank(search_vector, plainto_tsquery('english', ${title}))`))
      .limit(fetchLimit),

    db
      .select({
        id: posts.id,
        title: posts.title,
        content: posts.content,
        voteCount: posts.voteCount,
        commentCount: posts.commentCount,
        createdAt: posts.createdAt,
        score: sql<number>`1 - (embedding <=> ${vectorStr}::vector)`.as('vec_score'),
      })
      .from(posts)
      .where(
        and(
          isNull(posts.deletedAt),
          isNull(posts.canonicalPostId),
          sql`embedding IS NOT NULL`,
          sql`${posts.id} != ${toUuid(postId)}::uuid`,
          sql`1 - (embedding <=> ${vectorStr}::vector) >= ${VECTOR_THRESHOLD}`
        )
      )
      .orderBy(desc(sql`1 - (embedding <=> ${vectorStr}::vector)`))
      .limit(fetchLimit),
  ])

  // Merge scores
  const scoreMap = new Map<string, MergeCandidate & { vectorScore: number; ftsScore: number }>()

  for (const r of vectorMatches) {
    scoreMap.set(r.id, {
      postId: r.id,
      title: r.title,
      content: r.content,
      voteCount: r.voteCount,
      commentCount: r.commentCount,
      createdAt: r.createdAt,
      vectorScore: Number(r.score),
      ftsScore: 0,
      hybridScore: 0,
    })
  }

  for (const r of ftsMatches) {
    const normalizedFts = Math.min(Number(r.score) * 2, 1)
    const existing = scoreMap.get(r.id)
    if (existing) {
      existing.ftsScore = normalizedFts
    } else {
      scoreMap.set(r.id, {
        postId: r.id,
        title: r.title,
        content: r.content,
        voteCount: r.voteCount,
        commentCount: r.commentCount,
        createdAt: r.createdAt,
        vectorScore: 0,
        ftsScore: normalizedFts,
        hybridScore: 0,
      })
    }
  }

  return Array.from(scoreMap.values())
    .map((entry) => {
      entry.hybridScore =
        entry.ftsScore > 0
          ? Math.min(entry.vectorScore + entry.ftsScore * FTS_WEIGHT, 1)
          : entry.vectorScore
      return entry
    })
    .filter((c) => c.hybridScore >= HYBRID_THRESHOLD)
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, CANDIDATE_LIMIT)
}

// ============================================
// LLM assessment
// ============================================

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

interface Assessment {
  candidatePostId: PostId
  confidence: number
  reasoning: string
}

async function assessCandidates(
  sourcePost: { id: PostId; title: string; content: string },
  candidates: MergeCandidate[]
): Promise<Assessment[]> {
  if (candidates.length === 0) return []

  let prompt = `## Source Post\nID: ${sourcePost.id}\nTitle: ${sourcePost.title}\nContent: ${truncate(sourcePost.content, 2000)}\n\n## Candidates\n`
  for (const c of candidates) {
    prompt += `\n### Candidate\nID: ${c.postId}\nTitle: ${c.title}\nContent: ${truncate(c.content, 2000)}\n`
  }

  const completion = await withRetry(() =>
    openai.chat.completions.create({
      model: ASSESSMENT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_completion_tokens: 1000,
    })
  )

  const responseText = completion.choices[0]?.message?.content
  if (!responseText) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(responseText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, ''))
  } catch {
    console.error(`  Failed to parse LLM JSON: ${responseText.slice(0, 100)}`)
    return []
  }

  const results = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.results)
      ? (parsed as { results: unknown[] }).results
      : []

  const assessments: Assessment[] = []
  for (const item of results) {
    const r = item as Record<string, unknown>
    if (
      r.isDuplicate === true &&
      typeof r.confidence === 'number' &&
      r.confidence >= LLM_CONFIDENCE_THRESHOLD &&
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

// ============================================
// Direction + suggestion creation
// ============================================

function determineDirection(
  postA: { id: PostId; voteCount: number; commentCount: number; createdAt: Date },
  postB: { id: PostId; voteCount: number; commentCount: number; createdAt: Date }
): { sourcePostId: PostId; targetPostId: PostId } {
  if (postA.voteCount !== postB.voteCount) {
    return postA.voteCount > postB.voteCount
      ? { sourcePostId: postB.id, targetPostId: postA.id }
      : { sourcePostId: postA.id, targetPostId: postB.id }
  }
  if (postA.commentCount !== postB.commentCount) {
    return postA.commentCount > postB.commentCount
      ? { sourcePostId: postB.id, targetPostId: postA.id }
      : { sourcePostId: postA.id, targetPostId: postB.id }
  }
  return postA.createdAt <= postB.createdAt
    ? { sourcePostId: postB.id, targetPostId: postA.id }
    : { sourcePostId: postA.id, targetPostId: postB.id }
}

// ============================================
// Main backfill
// ============================================

async function main() {
  console.log('Quackback Merge Suggestion Backfill\n')
  console.log('Configuration:')
  console.log(`  Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`)
  console.log(`  Force re-check: ${force ? 'Yes' : 'No'}`)
  console.log(`  Limit: ${maxPosts ?? 'All posts'}`)
  console.log(`  Model: ${ASSESSMENT_MODEL}`)
  console.log(`  OpenAI Base URL: ${process.env.OPENAI_BASE_URL || 'default'}`)

  // Count eligible posts
  const whereConditions = and(
    isNull(posts.deletedAt),
    isNull(posts.canonicalPostId),
    sql`${posts.embedding} IS NOT NULL`,
    force
      ? sql`true`
      : or(isNull(posts.mergeCheckedAt), sql`${posts.mergeCheckedAt} < now() - interval '24 hours'`)
  )

  const [{ total }] = await db.select({ total: count() }).from(posts).where(whereConditions!)

  const totalToProcess = maxPosts ? Math.min(Number(total), maxPosts) : Number(total)
  console.log(`\n  Eligible posts: ${total}`)
  console.log(`  Will process: ${totalToProcess}\n`)

  if (totalToProcess === 0) {
    console.log('No posts to process.')
    await client.end()
    return
  }

  let processed = 0
  let suggestionsCreated = 0
  let failed = 0

  while (processed + failed < totalToProcess) {
    const batch = await db
      .select({
        id: posts.id,
        title: posts.title,
        content: posts.content,
        voteCount: posts.voteCount,
        commentCount: posts.commentCount,
        createdAt: posts.createdAt,
      })
      .from(posts)
      .where(whereConditions!)
      .orderBy(desc(posts.updatedAt))
      .limit(BATCH_SIZE)

    if (batch.length === 0) break

    for (const post of batch) {
      try {
        // Step 1: Find candidates
        const candidates = await findMergeCandidates(post.id)

        if (candidates.length === 0) {
          if (!dryRun) {
            await db.update(posts).set({ mergeCheckedAt: new Date() }).where(eq(posts.id, post.id))
          }
          console.log(
            `  [${processed + 1}/${totalToProcess}] ${truncate(post.title, 45)} - no candidates`
          )
          processed++
          continue
        }

        // Step 2: LLM assessment
        const assessments = await assessCandidates(
          { id: post.id, title: post.title, content: post.content },
          candidates
        )

        if (assessments.length === 0) {
          if (!dryRun) {
            await db.update(posts).set({ mergeCheckedAt: new Date() }).where(eq(posts.id, post.id))
          }
          console.log(
            `  [${processed + 1}/${totalToProcess}] ${truncate(post.title, 45)} - ${candidates.length} candidates, 0 confirmed`
          )
          processed++
          continue
        }

        // Step 3: Pick single best match (highest confidence, tiebreak by hybrid score)
        const bestAssessment = assessments.sort((a, b) => {
          if (b.confidence !== a.confidence) return b.confidence - a.confidence
          const candA = candidates.find((c) => c.postId === a.candidatePostId)
          const candB = candidates.find((c) => c.postId === b.candidatePostId)
          return (candB?.hybridScore ?? 0) - (candA?.hybridScore ?? 0)
        })[0]

        const bestCandidate = bestAssessment
          ? candidates.find((c) => c.postId === bestAssessment.candidatePostId)
          : undefined

        if (bestAssessment && bestCandidate) {
          const { sourcePostId, targetPostId } = determineDirection(
            {
              id: post.id,
              voteCount: post.voteCount,
              commentCount: post.commentCount,
              createdAt: post.createdAt,
            },
            {
              id: bestCandidate.postId,
              voteCount: bestCandidate.voteCount,
              commentCount: bestCandidate.commentCount,
              createdAt: bestCandidate.createdAt,
            }
          )

          if (dryRun) {
            console.log(
              `  [DRY RUN] Would create: "${truncate(post.title, 30)}" -> "${truncate(bestCandidate.title, 30)}" (${(bestAssessment.confidence * 100).toFixed(0)}%)`
            )
          } else {
            await db
              .insert(mergeSuggestions)
              .values({
                sourcePostId,
                targetPostId,
                vectorScore: bestCandidate.vectorScore,
                ftsScore: bestCandidate.ftsScore,
                hybridScore: bestCandidate.hybridScore,
                llmConfidence: bestAssessment.confidence,
                llmReasoning: bestAssessment.reasoning,
                llmModel: ASSESSMENT_MODEL,
              })
              .onConflictDoNothing()
          }
          suggestionsCreated++
        }

        if (!dryRun) {
          await db.update(posts).set({ mergeCheckedAt: new Date() }).where(eq(posts.id, post.id))
        }

        const matchLabel =
          bestAssessment && bestCandidate
            ? `matched -> "${truncate(bestCandidate.title, 30)}" (${(bestAssessment.confidence * 100).toFixed(0)}%)`
            : `${candidates.length} candidates, 0 confirmed`
        console.log(
          `  [${processed + 1}/${totalToProcess}] ${truncate(post.title, 45)} - ${matchLabel}`
        )
        processed++
      } catch (err) {
        failed++
        const errMsg = err instanceof Error ? err.message : String(err)
        const cause = err instanceof Error && 'cause' in err ? (err as any).cause : undefined
        console.error(
          `  [${processed + failed}/${totalToProcess}] ${truncate(post.title, 45)} - FAILED: ${errMsg}`
        )
        if (cause) console.error(`    Cause:`, cause)
      }

      // Delay between posts
      if (!dryRun) {
        await sleep(POST_DELAY_MS)
      }

      if (maxPosts && processed + failed >= maxPosts) break
    }

    console.log(
      `  Progress: ${processed} processed, ${suggestionsCreated} suggestions, ${failed} failed`
    )
  }

  console.log('\n--- Summary ---')
  console.log(`  Posts processed: ${processed}`)
  console.log(`  Suggestions created: ${suggestionsCreated}`)
  console.log(`  Failed: ${failed}`)
  console.log('\nBackfill complete!')

  await client.end()
}

main().catch(async (error) => {
  console.error('Fatal error:', error)
  await client.end()
  process.exit(1)
})

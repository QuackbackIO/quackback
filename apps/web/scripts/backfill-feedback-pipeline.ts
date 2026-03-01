#!/usr/bin/env bun
/**
 * Backfill posts into the feedback aggregation pipeline.
 *
 * Finds all active posts not yet ingested into raw_feedback_items,
 * inserts them as ready_for_extraction, and enqueues BullMQ jobs
 * for AI processing. Idempotent — safe to re-run.
 *
 * Requires the dev server running (BullMQ workers process the jobs).
 *
 * Usage:
 *   bun scripts/backfill-feedback-pipeline.ts              # Backfill all unprocessed posts
 *   bun scripts/backfill-feedback-pipeline.ts --limit 50   # Process at most 50 posts
 *   bun scripts/backfill-feedback-pipeline.ts --dry-run    # Show what would be ingested
 *   bun scripts/backfill-feedback-pipeline.ts --poll        # Wait and show progress after enqueue
 */

try {
  const { config } = await import('dotenv')
  config({ path: '../../.env', quiet: true })
} catch {
  /* optional dotenv */
}

import postgres from 'postgres'
import { generateId, toUuid } from '@quackback/ids'

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback'
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const sql = postgres(DB_URL)

const DRY_RUN = process.argv.includes('--dry-run')
const POLL = process.argv.includes('--poll')
const limitIdx = process.argv.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : null

async function main() {
  console.log(`\n=== Feedback Pipeline Backfill${DRY_RUN ? ' (DRY RUN)' : ''} ===\n`)

  // 1. Ensure quackback feedback source exists
  let [source] = await sql`
    SELECT id FROM feedback_sources WHERE source_type = 'quackback' LIMIT 1
  `
  if (!source) {
    if (DRY_RUN) {
      console.log(`  Would create quackback feedback source`)
    } else {
      const id = toUuid(generateId('feedback_source'))
      await sql`
        INSERT INTO feedback_sources (id, source_type, delivery_mode, name, enabled)
        VALUES (${id}, 'quackback', 'passive', 'Quackback', true)
      `
      source = { id }
      console.log(`  Created quackback feedback source: ${id}`)
    }
  } else {
    console.log(`  Feedback source: ${source.id}`)
  }

  if (DRY_RUN && !source) {
    // Without a source ID we can't query for unprocessed posts — just count them
    const [counts] = await sql`
      SELECT
        (SELECT count(*)::int FROM posts WHERE deleted_at IS NULL AND canonical_post_id IS NULL) AS total_active,
        (SELECT count(*)::int FROM raw_feedback_items WHERE source_type = 'quackback') AS already_ingested
    `
    console.log(`  Total active posts:  ${counts.total_active}`)
    console.log(`  Already ingested:    ${counts.already_ingested}`)
    console.log(`  To backfill:         ~${counts.total_active - counts.already_ingested}`)
    await sql.end()
    return
  }

  const sourceId = source.id

  // 2. Find active posts not yet ingested
  //    Posts are stored as externalId = 'post:{uuid}' in raw_feedback_items.
  //    Skip deleted posts and merged duplicates (canonical_post_id IS NOT NULL).
  const posts = await sql`
    SELECT
      p.id,
      p.title,
      p.content,
      p.principal_id,
      p.vote_count,
      p.comment_count,
      p.created_at,
      b.slug AS board_slug,
      u.name AS author_name,
      u.email AS author_email
    FROM posts p
    JOIN boards b ON p.board_id = b.id
    LEFT JOIN principal pr ON p.principal_id = pr.id
    LEFT JOIN "user" u ON pr.user_id = u.id
    WHERE p.deleted_at IS NULL
      AND p.canonical_post_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM raw_feedback_items r
        WHERE r.source_id = ${sourceId}
          AND r.external_id = 'post:' || p.id::text
      )
    ORDER BY p.created_at ASC
    ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}
  `

  // Quick stats on what's already processed
  const [counts] = await sql`
    SELECT
      (SELECT count(*)::int FROM posts WHERE deleted_at IS NULL AND canonical_post_id IS NULL) AS total_active,
      (SELECT count(*)::int FROM raw_feedback_items WHERE source_type = 'quackback') AS already_ingested
  `

  console.log(`  Total active posts:  ${counts.total_active}`)
  console.log(`  Already ingested:    ${counts.already_ingested}`)
  console.log(`  To backfill:         ${posts.length}${LIMIT ? ` (limited to ${LIMIT})` : ''}\n`)

  // 2b. Check for stuck/failed items that need re-enqueuing
  const [stuckCounts] = await sql`
    SELECT
      count(*) FILTER (WHERE processing_state IN ('extracting', 'interpreting'))::int AS stuck,
      count(*) FILTER (WHERE processing_state = 'failed')::int AS failed,
      count(*) FILTER (WHERE processing_state = 'ready_for_extraction')::int AS ready
    FROM raw_feedback_items
    WHERE source_type = 'quackback'
  `
  const retriable = stuckCounts.stuck + stuckCounts.failed + stuckCounts.ready
  if (retriable > 0) {
    console.log(
      `  Retriable items:     ${retriable} (${stuckCounts.stuck} stuck, ${stuckCounts.failed} failed, ${stuckCounts.ready} ready)`
    )
  }

  if (posts.length === 0 && retriable === 0) {
    console.log(`\nNothing to do — all posts are ingested and processed.`)
    await sql.end()
    return
  }

  if (DRY_RUN) {
    if (posts.length > 0) {
      console.log(`Posts that would be ingested:`)
      for (const p of posts.slice(0, 20)) {
        console.log(
          `  ${p.created_at.toISOString().slice(0, 10)}  ${p.title?.slice(0, 60) ?? '(no title)'}`
        )
      }
      if (posts.length > 20) console.log(`  ... and ${posts.length - 20} more`)
    }
    if (retriable > 0) {
      console.log(`Would reset and re-enqueue ${retriable} stuck/failed items`)
    }
    await sql.end()
    return
  }

  // 3. Batch-insert raw feedback items (skip if no new posts)
  if (posts.length > 0) {
    //    We skip the enrich-context step (which just resolves principalId) since we
    //    already have the principalId from the post. Insert directly as ready_for_extraction.
    console.log(`Inserting ${posts.length} raw feedback items...`)

    const BATCH_SIZE = 100
    let inserted = 0

    for (let i = 0; i < posts.length; i += BATCH_SIZE) {
      const batch = posts.slice(i, i + BATCH_SIZE)
      const values = batch.map((p) => ({
        id: toUuid(generateId('raw_feedback')),
        source_id: sourceId,
        source_type: 'quackback',
        external_id: `post:${p.id}`,
        dedupe_key: `quackback:post:${p.id}`,
        source_created_at: p.created_at,
        author: sql.json({
          principalId: p.principal_id,
          email: p.author_email,
          name: p.author_name,
        }),
        content: sql.json({
          subject: p.title,
          text: p.content || '',
        }),
        context_envelope: sql.json({
          metadata: {
            voteCount: p.vote_count,
            boardSlug: p.board_slug,
          },
        }),
        processing_state: 'ready_for_extraction',
        state_changed_at: new Date(),
        principal_id: p.principal_id,
      }))

      // Use ON CONFLICT for idempotency
      for (const v of values) {
        await sql`
          INSERT INTO raw_feedback_items (
            id, source_id, source_type, external_id, dedupe_key, source_created_at,
            author, content, context_envelope, processing_state, state_changed_at, principal_id
          ) VALUES (
            ${v.id}, ${v.source_id}, ${v.source_type}, ${v.external_id}, ${v.dedupe_key},
            ${v.source_created_at}, ${v.author}, ${v.content}, ${v.context_envelope},
            ${v.processing_state}, ${v.state_changed_at}, ${v.principal_id}
          ) ON CONFLICT (source_id, dedupe_key) DO NOTHING
        `
      }

      inserted += batch.length
      if (posts.length > BATCH_SIZE) {
        console.log(`  ${inserted}/${posts.length} inserted`)
      }
    }

    console.log(`  Inserted ${inserted} raw feedback items\n`)
  }

  // 4. Reset stuck/failed items back to ready_for_extraction so they get re-enqueued
  const [resetResult] = await sql`
    UPDATE raw_feedback_items
    SET processing_state = 'ready_for_extraction',
        state_changed_at = NOW(),
        last_error = NULL,
        attempt_count = 0,
        updated_at = NOW()
    WHERE source_type = 'quackback'
      AND processing_state IN ('extracting', 'interpreting', 'failed')
    RETURNING id
  `
  if (resetResult) {
    const [resetTotal] = await sql`
      SELECT count(*)::int as cnt FROM raw_feedback_items
      WHERE source_type = 'quackback'
        AND processing_state = 'ready_for_extraction'
        AND updated_at >= NOW() - interval '5 seconds'
    `
    if (resetTotal.cnt > 0) {
      console.log(`Reset ${resetTotal.cnt} stuck/failed items to ready_for_extraction`)
    }
  }

  // Also reset any failed signals so they get re-interpreted
  const [resetSignals] = await sql`
    WITH reset AS (
      UPDATE feedback_signals
      SET processing_state = 'pending_interpretation',
          updated_at = NOW()
      WHERE processing_state = 'failed'
      RETURNING id
    )
    SELECT count(*)::int AS cnt FROM reset
  `
  if (resetSignals.cnt > 0) {
    console.log(`Reset ${resetSignals.cnt} failed signals to pending_interpretation`)
  }

  const readyItems = await sql`
    SELECT id FROM raw_feedback_items
    WHERE processing_state = 'ready_for_extraction'
      AND source_type = 'quackback'
    ORDER BY source_created_at ASC
  `

  console.log(`Enqueuing ${readyItems.length} extract-signals jobs...`)

  const { Queue } = await import('bullmq')
  const aiQueue = new Queue('{feedback-ai}', {
    connection: { url: REDIS_URL, maxRetriesPerRequest: null },
  })

  for (const item of readyItems) {
    await aiQueue.add(
      'ai:extract-signals',
      { type: 'extract-signals', rawItemId: item.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { age: 14 * 86400 },
      }
    )
  }

  await aiQueue.close()
  console.log(`  Enqueued ${readyItems.length} jobs\n`)

  console.log(
    `Pipeline is processing. The dev server's BullMQ workers will handle extraction + interpretation.`
  )

  if (!POLL) {
    console.log(`Run with --poll to watch progress, or check the dashboard.\n`)
    await sql.end()
    return
  }

  // 5. Poll for completion
  console.log(`\nWatching progress (Ctrl+C to stop)...\n`)
  const startTime = Date.now()
  const timeout = 60 * 60 * 1000 // 1 hour max

  while (Date.now() - startTime < timeout) {
    await new Promise((r) => setTimeout(r, 5000))

    const [raw] = await sql`
      SELECT
        count(*)::int as total,
        count(*) FILTER (WHERE processing_state = 'completed')::int as completed,
        count(*) FILTER (WHERE processing_state = 'failed')::int as failed,
        count(*) FILTER (WHERE processing_state IN ('extracting', 'interpreting'))::int as processing
      FROM raw_feedback_items
    `
    const [sig] = await sql`
      SELECT
        count(*)::int as total,
        count(*) FILTER (WHERE processing_state = 'completed')::int as completed,
        count(*) FILTER (WHERE processing_state = 'failed')::int as failed
      FROM feedback_signals
    `
    const [sug] = await sql`
      SELECT count(*)::int as total FROM feedback_suggestions
      WHERE status = 'pending'
    `

    const elapsed = Date.now() - startTime
    const mm = String(Math.floor(elapsed / 60000)).padStart(2, '0')
    const ss = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0')

    const bar = (done: number, total: number, width = 25) => {
      if (total === 0) return '░'.repeat(width)
      const filled = Math.min(width, Math.round((done / total) * width))
      return '█'.repeat(filled) + '░'.repeat(width - filled)
    }

    const rawDone = raw.completed + raw.failed
    const sigDone = sig.completed + sig.failed

    console.log(
      `  ${mm}:${ss}  Items  ${bar(rawDone, raw.total)} ${rawDone}/${raw.total} (${raw.processing} active, ${raw.failed} failed)`
    )
    console.log(
      `         Signals ${bar(sigDone, Math.max(sig.total, 1))} ${sig.completed}/${sig.total} done${sig.failed > 0 ? `, ${sig.failed} failed` : ''}`
    )
    console.log(`         Suggestions: ${sug.total} pending`)

    // All done when all raw items are terminal and all signals are terminal
    const allRawDone = rawDone >= raw.total && raw.total > 0
    const allSigDone = sig.total === 0 || sigDone >= sig.total
    if (allRawDone && allSigDone) {
      console.log(`\n  Done in ${mm}:${ss}`)
      console.log(
        `  ${raw.completed} items processed, ${sig.total} signals, ${sug.total} pending suggestions`
      )
      break
    }
  }

  await sql.end()
}

main().catch(async (err) => {
  console.error('Fatal:', err)
  await sql.end()
  process.exit(1)
})

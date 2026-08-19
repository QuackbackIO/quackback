/**
 * Synchronise denormalized counts with their source-of-truth tables.
 *
 * Currently syncs: comment_count on posts.
 * Only touches rows where the count has drifted.
 *
 * Usage: bun run db:sync-counts
 */
import { config } from 'dotenv'
config({ path: '../../.env', quiet: true })

import postgres from 'postgres'

async function syncCommentCounts() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('❌ DATABASE_URL environment variable is required')
    process.exit(1)
  }

  const sql = postgres(connectionString, { max: 1 })

  try {
    console.log('Synchronising comment counts...\n')

    // Same predicate as recalculateCanonicalVoteCount: a canonical's public
    // count is its own visible comments plus those on live, non-deleted-board
    // sources merged into it. A source (or standalone post) counts only itself.
    const result = await sql`
      UPDATE posts
      SET comment_count = (
        SELECT COUNT(*)::int
        FROM post_comments c
        WHERE c.deleted_at IS NULL
          AND c.is_private = false
          AND c.moderation_state <> 'pending'
          AND c.post_id IN (
            SELECT posts.id
            UNION ALL
            SELECT s.id
            FROM posts s
            INNER JOIN boards b ON b.id = s.board_id
            WHERE s.canonical_post_id = posts.id
              AND s.deleted_at IS NULL
              AND b.deleted_at IS NULL
          )
      )
      WHERE comment_count != (
        SELECT COUNT(*)::int
        FROM post_comments c
        WHERE c.deleted_at IS NULL
          AND c.is_private = false
          AND c.moderation_state <> 'pending'
          AND c.post_id IN (
            SELECT posts.id
            UNION ALL
            SELECT s.id
            FROM posts s
            INNER JOIN boards b ON b.id = s.board_id
            WHERE s.canonical_post_id = posts.id
              AND s.deleted_at IS NULL
              AND b.deleted_at IS NULL
          )
      )
    `

    const updated = result.count
    if (updated > 0) {
      console.log(`✅ Fixed ${updated} post(s) with incorrect comment counts`)
    } else {
      console.log('✅ All comment counts are already correct')
    }
  } finally {
    await sql.end()
  }
}

syncCommentCounts().catch((error) => {
  console.error('❌ Sync failed:', error)
  process.exitCode = 1
})

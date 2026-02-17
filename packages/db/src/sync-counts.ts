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

    // Single UPDATE that recalculates from source of truth
    const result = await sql`
      UPDATE posts
      SET comment_count = (
        SELECT COUNT(*)::int
        FROM comments
        WHERE comments.post_id = posts.id
          AND comments.deleted_at IS NULL
      )
      WHERE comment_count != (
        SELECT COUNT(*)::int
        FROM comments
        WHERE comments.post_id = posts.id
          AND comments.deleted_at IS NULL
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

/**
 * Migration Script: Migrate Official Responses to Pinned Comments
 *
 * This script converts existing officialResponse data stored directly on posts
 * into comments that are then pinned as the official response.
 *
 * What it does:
 * 1. Finds all posts that have officialResponse content but no pinnedCommentId
 * 2. For each post, creates a new comment with the official response content
 * 3. Sets that comment as the pinnedCommentId on the post
 *
 * Run this script after applying the 0008_add_pinned_comment.sql migration.
 *
 * Usage: bun run packages/db/scripts/migrate-official-responses.ts
 */

import { eq, isNotNull, isNull, and } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/schema'
import { createId } from '@quackback/ids'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

async function migrateOfficialResponses() {
  console.log('Starting migration of official responses to pinned comments...\n')

  const client = postgres(DATABASE_URL!)
  const db = drizzle(client, { schema })

  try {
    // Find posts with official response content but no pinned comment
    const postsToMigrate = await db.query.posts.findMany({
      where: and(isNotNull(schema.posts.officialResponse), isNull(schema.posts.pinnedCommentId)),
    })

    console.log(`Found ${postsToMigrate.length} posts with official responses to migrate\n`)

    if (postsToMigrate.length === 0) {
      console.log('No posts to migrate. Exiting.')
      await client.end()
      return
    }

    let migrated = 0
    let skipped = 0
    let errors = 0

    for (const post of postsToMigrate) {
      try {
        if (!post.officialResponse) {
          skipped++
          continue
        }

        // Determine the author - try to find the member or use fallback
        const memberId = post.officialResponseMemberId
        let authorName = post.officialResponseAuthorName || 'Team'

        // If we have a memberId, get the member's name
        if (memberId) {
          const member = await db.query.member.findFirst({
            where: eq(schema.member.id, memberId),
          })
          if (member) {
            authorName = member.displayName || authorName
          }
        }

        // Create the comment
        const commentId = createId('comment')
        const createdAt = post.officialResponseAt || post.createdAt

        await db.insert(schema.comments).values({
          id: commentId,
          postId: post.id,
          memberId: memberId || null,
          authorName,
          authorEmail: null, // Official responses don't have email
          content: post.officialResponse,
          isTeamMember: true,
          parentId: null,
          createdAt,
        })

        // Set the comment as pinned
        await db
          .update(schema.posts)
          .set({ pinnedCommentId: commentId })
          .where(eq(schema.posts.id, post.id))

        // Increment comment count
        await db
          .update(schema.posts)
          .set({ commentCount: (post.commentCount || 0) + 1 })
          .where(eq(schema.posts.id, post.id))

        migrated++
        console.log(`✓ Migrated post ${post.id}: "${post.title?.slice(0, 50)}..."`)
      } catch (err) {
        errors++
        console.error(`✗ Failed to migrate post ${post.id}:`, err)
      }
    }

    console.log('\n--- Migration Summary ---')
    console.log(`Total posts found: ${postsToMigrate.length}`)
    console.log(`Successfully migrated: ${migrated}`)
    console.log(`Skipped (no content): ${skipped}`)
    console.log(`Errors: ${errors}`)

    if (errors > 0) {
      console.log('\nSome posts failed to migrate. Please review the errors above.')
    } else {
      console.log('\nMigration completed successfully!')
      console.log('\nNote: The old officialResponse columns are preserved for rollback safety.')
      console.log('You can remove them in a future migration after verifying the data.')
    }
  } finally {
    await client.end()
  }
}

// Run the migration
migrateOfficialResponses().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

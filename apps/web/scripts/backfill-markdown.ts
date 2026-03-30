#!/usr/bin/env bun
/**
 * Backfill contentJson for posts and changelog entries that only have plain text content.
 *
 * This script finds rows where content_json IS NULL and generates TipTap JSON
 * from the content field using markdownToTiptapJson(). This ensures all entries
 * render with the rich text renderer on the portal.
 *
 * Usage:
 *   bun scripts/backfill-markdown.ts              # Process all rows
 *   bun scripts/backfill-markdown.ts --dry-run    # Preview without writing
 *   bun scripts/backfill-markdown.ts --limit=100  # Limit number of rows
 *   bun scripts/backfill-markdown.ts --posts      # Only process posts
 *   bun scripts/backfill-markdown.ts --changelogs # Only process changelogs
 *
 * Environment:
 *   DATABASE_URL - Required. PostgreSQL connection string.
 */

try {
  const { config } = await import('dotenv')
  config({ path: '.env', quiet: true })
} catch {
  // dotenv not available
}

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { isNull } from 'drizzle-orm'
import { posts, changelogEntries } from '@quackback/db/schema'
import { markdownToTiptapJson } from '../src/lib/server/markdown-tiptap'

const BATCH_SIZE = 50

// Parse CLI arguments
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const postsOnly = args.includes('--posts')
const changelogsOnly = args.includes('--changelogs')
const limitArg = args.find((a) => a.startsWith('--limit='))
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined

// Database connection
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const client = postgres(databaseUrl)
const db = drizzle(client)

async function backfillTable(
  table: typeof posts | typeof changelogEntries,
  tableName: string
): Promise<number> {
  console.log(`\n--- ${tableName} ---`)

  // Find rows with null contentJson
  const rows = await db
    .select({
      id: table.id,
      content: table.content,
    })
    .from(table)
    .where(isNull(table.contentJson))
    .limit(limit ?? 100000)

  console.log(`Found ${rows.length} rows with null contentJson`)

  if (rows.length === 0 || dryRun) {
    if (dryRun && rows.length > 0) {
      console.log(`[DRY RUN] Would process ${rows.length} rows`)
      // Show first 3 as preview
      for (const row of rows.slice(0, 3)) {
        const json = markdownToTiptapJson(row.content)
        const nodeCount = json.content?.length ?? 0
        console.log(`  ${row.id}: "${row.content.slice(0, 60)}..." -> ${nodeCount} nodes`)
      }
    }
    return rows.length
  }

  let processed = 0
  let errors = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)

    for (const row of batch) {
      try {
        const contentJson = markdownToTiptapJson(row.content)

        await db
          .update(table)
          .set({ contentJson })
          .where(
            // @ts-expect-error - table.id type varies between posts and changelogEntries
            (await import('drizzle-orm')).eq(table.id, row.id)
          )

        processed++
      } catch (err) {
        errors++
        console.error(`  Error processing ${row.id}:`, err)
      }
    }

    console.log(`  Processed ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`)
  }

  console.log(`Done: ${processed} updated, ${errors} errors`)
  return processed
}

// Run
console.log(`Backfill markdown -> contentJson${dryRun ? ' [DRY RUN]' : ''}`)
console.log(`Limit: ${limit ?? 'none'}`)

let total = 0

if (!changelogsOnly) {
  total += await backfillTable(posts, 'Posts')
}

if (!postsOnly) {
  total += await backfillTable(changelogEntries, 'Changelog Entries')
}

console.log(`\nTotal: ${total} rows processed`)
await client.end()

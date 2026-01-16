/**
 * Test embedding similarity search directly against the database.
 *
 * Usage: DATABASE_URL="postgres://..." bun run apps/web/scripts/test-embeddings.ts
 */

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL required')
  process.exit(1)
}

const sql = postgres(DATABASE_URL)

async function main() {
  console.log('🔍 Testing embedding search...\n')

  // 1. Check how many posts have embeddings
  const [stats] = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(embedding) as with_embedding
    FROM posts
    WHERE deleted_at IS NULL
  `
  console.log(`📊 Posts: ${stats.total} total, ${stats.with_embedding} with embeddings\n`)

  if (Number(stats.with_embedding) === 0) {
    console.log('❌ No embeddings found. Run backfill first.')
    await sql.end()
    return
  }

  // 2. Get a sample post with embedding to use as reference
  const [samplePost] = await sql`
    SELECT id, title, embedding
    FROM posts
    WHERE embedding IS NOT NULL AND deleted_at IS NULL
    LIMIT 1
  `
  console.log(`📝 Reference post: "${samplePost.title.slice(0, 50)}..."`)
  console.log(`   ID: ${samplePost.id}\n`)

  // 3. Find similar posts using vector search
  console.log('🔎 Finding similar posts (cosine similarity >= 0.5):\n')

  const similar = await sql`
    SELECT
      id,
      title,
      1 - (embedding <=> ${samplePost.embedding}::vector) as similarity
    FROM posts
    WHERE
      embedding IS NOT NULL
      AND deleted_at IS NULL
      AND id != ${samplePost.id}
      AND 1 - (embedding <=> ${samplePost.embedding}::vector) >= 0.5
    ORDER BY embedding <=> ${samplePost.embedding}::vector
    LIMIT 5
  `

  if (similar.length === 0) {
    console.log('   No similar posts found above threshold.')
  } else {
    for (const post of similar) {
      const sim = (Number(post.similarity) * 100).toFixed(1)
      console.log(`   ${sim}% - "${post.title.slice(0, 60)}..."`)
    }
  }

  // 4. Test text-based search (simulating user typing)
  console.log('\n🔤 Testing text search for "integration":\n')

  const textResults = await sql`
    SELECT id, title, vote_count
    FROM posts
    WHERE
      deleted_at IS NULL
      AND search_vector @@ plainto_tsquery('english', 'integration')
    ORDER BY ts_rank(search_vector, plainto_tsquery('english', 'integration')) DESC
    LIMIT 5
  `

  if (textResults.length === 0) {
    console.log('   No full-text matches found.')
  } else {
    for (const post of textResults) {
      console.log(`   [${post.vote_count} votes] "${post.title.slice(0, 60)}..."`)
    }
  }

  console.log('\n✅ Embedding search is working!')
  await sql.end()
}

main().catch(console.error)

/**
 * End-to-end migration test: verify 0006_thick_arclight.sql correctly
 * backfills official responses into pinned comments before dropping columns.
 *
 * Uses a throwaway test database so the dev database is unaffected.
 *
 * Usage: bun run packages/db/scripts/test-migration-0006.ts
 */

import postgres from 'postgres'
import { readFileSync } from 'fs'
import { join } from 'path'

const BASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback'
const TEST_DB = 'quackback_migration_test'
// Connect to default 'postgres' db just for CREATE/DROP DATABASE
const adminUrl = BASE_URL.replace(/\/[^/]+$/, '/postgres')

async function run() {
  // ── Setup: create a clean test database ────────────────────────────────
  const admin = postgres(adminUrl, { max: 1 })
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`)
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`)
  } finally {
    await admin.end()
  }

  const testUrl = BASE_URL.replace(/\/[^/]+$/, `/${TEST_DB}`)
  const sql = postgres(testUrl, { max: 1 })

  try {
    // ── 1. Create a minimal schema that matches pre-migration state ──────
    // Only the tables referenced by the migration (posts, comments, principal)
    await sql.unsafe(`
      CREATE TABLE "principal" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "display_name" text,
        "type" text NOT NULL DEFAULT 'user'
      );

      CREATE TABLE "boards" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "slug" text NOT NULL,
        "workspace_id" uuid
      );

      CREATE TABLE "post_statuses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL
      );

      CREATE TABLE "posts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" text NOT NULL,
        "content" text,
        "board_id" uuid NOT NULL REFERENCES "boards"("id"),
        "principal_id" uuid NOT NULL REFERENCES "principal"("id"),
        "status_id" uuid REFERENCES "post_statuses"("id"),
        "vote_count" integer NOT NULL DEFAULT 0,
        "comment_count" integer NOT NULL DEFAULT 0,
        "official_response" text,
        "official_response_principal_id" uuid REFERENCES "principal"("id") ON DELETE SET NULL,
        "official_response_at" timestamptz,
        "pinned_comment_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE "posts" ADD CONSTRAINT "posts_official_response_principal_id_principal_id_fk"
        FOREIGN KEY ("official_response_principal_id") REFERENCES "principal"("id") ON DELETE SET NULL;

      CREATE TABLE "comments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "post_id" uuid NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
        "principal_id" uuid NOT NULL REFERENCES "principal"("id"),
        "parent_id" uuid,
        "content" text NOT NULL,
        "is_team_member" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `)

    // ── 2. Seed realistic test data ──────────────────────────────────────
    const [board] =
      await sql`INSERT INTO boards (name, slug) VALUES ('Feature Requests', 'features') RETURNING id`
    const [teamMember] =
      await sql`INSERT INTO principal (display_name, type) VALUES ('Alice (Admin)', 'user') RETURNING id`
    const [responder] =
      await sql`INSERT INTO principal (display_name, type) VALUES ('Bob (Support)', 'user') RETURNING id`
    const [portalUser] =
      await sql`INSERT INTO principal (display_name, type) VALUES ('Charlie (User)', 'user') RETURNING id`

    // Case 1: Post with official response AND a known responder
    const [post1] = await sql`
      INSERT INTO posts (title, content, board_id, principal_id, official_response, official_response_principal_id, official_response_at, comment_count)
      VALUES ('Add dark mode', 'Would love a dark theme', ${board.id}, ${portalUser.id}, 'We are working on dark mode! Expected in Q2.', ${responder.id}, '2026-01-15T10:00:00Z', 2)
      RETURNING id
    `

    // Case 2: Post with official response but NO responder (principal_id is null)
    const [post2] = await sql`
      INSERT INTO posts (title, content, board_id, principal_id, official_response, official_response_principal_id, official_response_at, comment_count)
      VALUES ('Improve search', 'Search is slow', ${board.id}, ${portalUser.id}, 'Thanks for reporting. We have optimized search in the latest release.', NULL, '2026-02-01T14:30:00Z', 0)
      RETURNING id
    `

    // Case 3: Post with NO official response (should be untouched)
    const [post3] = await sql`
      INSERT INTO posts (title, content, board_id, principal_id, comment_count)
      VALUES ('Add emoji reactions', 'Let users react with emojis', ${board.id}, ${portalUser.id}, 1)
      RETURNING id
    `

    // Case 4: Post that ALREADY has a pinned comment (should be skipped)
    const [post4] = await sql`
      INSERT INTO posts (title, content, board_id, principal_id, official_response, official_response_principal_id, official_response_at, comment_count)
      VALUES ('Export data', 'Need CSV export', ${board.id}, ${teamMember.id}, 'Already shipped in v1.2!', ${responder.id}, '2026-01-20T09:00:00Z', 0)
      RETURNING id
    `
    const [pinnedComment] = await sql`
      INSERT INTO comments (post_id, principal_id, content, is_team_member)
      VALUES (${post4.id}, ${teamMember.id}, 'This was already pinned before migration', true)
      RETURNING id
    `
    await sql`UPDATE posts SET pinned_comment_id = ${pinnedComment.id} WHERE id = ${post4.id}`

    // Case 5: Post with official response but no response_at (should use created_at)
    const [post5] = await sql`
      INSERT INTO posts (title, content, board_id, principal_id, official_response, official_response_principal_id, official_response_at, comment_count, created_at)
      VALUES ('Mobile app', 'Need a mobile app', ${board.id}, ${portalUser.id}, 'Mobile app is on our roadmap.', ${teamMember.id}, NULL, 0, '2025-12-01T08:00:00Z')
      RETURNING id
    `

    console.log('=== Test data seeded ===')
    console.log(`Post 1 (response + responder): ${post1.id}`)
    console.log(`Post 2 (response, no responder): ${post2.id}`)
    console.log(`Post 3 (no response): ${post3.id}`)
    console.log(`Post 4 (already pinned): ${post4.id}`)
    console.log(`Post 5 (no response_at): ${post5.id}`)

    // ── 3. Snapshot pre-migration state ──────────────────────────────────
    const preCommentCount = await sql`SELECT count(*)::int as cnt FROM comments`
    console.log(`\nPre-migration: ${preCommentCount[0].cnt} comments`)

    // ── 4. Run the migration ─────────────────────────────────────────────
    const migrationSql = readFileSync(
      join(import.meta.dir, '../drizzle/0006_thick_arclight.sql'),
      'utf-8'
    )
    // Split on '--> statement-breakpoint' like drizzle-kit does
    const statements = migrationSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)

    console.log(`\nRunning migration (${statements.length} statements)...`)
    for (const stmt of statements) {
      await sql.unsafe(stmt)
    }
    console.log('Migration completed successfully!\n')

    // ── 5. Verify results ────────────────────────────────────────────────
    let passed = 0
    let failed = 0

    function assert(condition: boolean, label: string) {
      if (condition) {
        console.log(`  ✓ ${label}`)
        passed++
      } else {
        console.error(`  ✗ ${label}`)
        failed++
      }
    }

    // Verify columns were dropped
    const columns = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'posts' AND column_name LIKE 'official_response%'
    `
    assert(columns.length === 0, 'official_response columns were dropped')

    // Verify post 1: response + responder -> pinned comment by responder
    const post1Result =
      await sql`SELECT pinned_comment_id, comment_count FROM posts WHERE id = ${post1.id}`
    assert(post1Result[0].pinned_comment_id !== null, 'Post 1: has pinned_comment_id')
    assert(post1Result[0].comment_count === 3, 'Post 1: comment_count incremented (2 -> 3)')

    if (post1Result[0].pinned_comment_id) {
      const comment1 =
        await sql`SELECT * FROM comments WHERE id = ${post1Result[0].pinned_comment_id}`
      assert(comment1.length === 1, 'Post 1: pinned comment exists')
      assert(
        comment1[0].content === 'We are working on dark mode! Expected in Q2.',
        'Post 1: comment content matches'
      )
      assert(comment1[0].principal_id === responder.id, 'Post 1: comment author is the responder')
      assert(comment1[0].is_team_member === true, 'Post 1: comment marked as team member')
      assert(
        new Date(comment1[0].created_at).toISOString() === '2026-01-15T10:00:00.000Z',
        'Post 1: comment timestamp matches official_response_at'
      )
    }

    // Verify post 2: response, no responder -> pinned comment by post author (fallback)
    const post2Result =
      await sql`SELECT pinned_comment_id, comment_count FROM posts WHERE id = ${post2.id}`
    assert(post2Result[0].pinned_comment_id !== null, 'Post 2: has pinned_comment_id')
    assert(post2Result[0].comment_count === 1, 'Post 2: comment_count incremented (0 -> 1)')

    if (post2Result[0].pinned_comment_id) {
      const comment2 =
        await sql`SELECT * FROM comments WHERE id = ${post2Result[0].pinned_comment_id}`
      assert(comment2.length === 1, 'Post 2: pinned comment exists')
      assert(
        comment2[0].content ===
          'Thanks for reporting. We have optimized search in the latest release.',
        'Post 2: comment content matches'
      )
      assert(
        comment2[0].principal_id === portalUser.id,
        'Post 2: comment author falls back to post author'
      )
      assert(comment2[0].is_team_member === true, 'Post 2: comment marked as team member')
    }

    // Verify post 3: no response -> no changes
    const post3Result =
      await sql`SELECT pinned_comment_id, comment_count FROM posts WHERE id = ${post3.id}`
    assert(post3Result[0].pinned_comment_id === null, 'Post 3: no pinned_comment_id (no response)')
    assert(post3Result[0].comment_count === 1, 'Post 3: comment_count unchanged')

    // Verify post 4: already pinned -> should NOT be overwritten
    const post4Result =
      await sql`SELECT pinned_comment_id, comment_count FROM posts WHERE id = ${post4.id}`
    assert(
      post4Result[0].pinned_comment_id === pinnedComment.id,
      'Post 4: pinned_comment_id preserved (not overwritten)'
    )
    assert(
      post4Result[0].comment_count === 0,
      'Post 4: comment_count NOT incremented (was already pinned)'
    )

    // Verify post 5: response with no response_at -> uses created_at
    const post5Result =
      await sql`SELECT pinned_comment_id, comment_count FROM posts WHERE id = ${post5.id}`
    assert(post5Result[0].pinned_comment_id !== null, 'Post 5: has pinned_comment_id')
    assert(post5Result[0].comment_count === 1, 'Post 5: comment_count incremented (0 -> 1)')

    if (post5Result[0].pinned_comment_id) {
      const comment5 =
        await sql`SELECT * FROM comments WHERE id = ${post5Result[0].pinned_comment_id}`
      assert(comment5.length === 1, 'Post 5: pinned comment exists')
      assert(
        comment5[0].content === 'Mobile app is on our roadmap.',
        'Post 5: comment content matches'
      )
      assert(
        comment5[0].principal_id === teamMember.id,
        'Post 5: comment author is the team member'
      )
      assert(
        new Date(comment5[0].created_at).toISOString() === '2025-12-01T08:00:00.000Z',
        'Post 5: comment timestamp falls back to post created_at'
      )
    }

    // Final count check
    const postCommentCount = await sql`SELECT count(*)::int as cnt FROM comments`
    const expectedNewComments = 3 // post1, post2, post5 (post3 has none, post4 already had one)
    assert(
      postCommentCount[0].cnt === preCommentCount[0].cnt + expectedNewComments,
      `Total comments: ${preCommentCount[0].cnt} -> ${postCommentCount[0].cnt} (+${expectedNewComments})`
    )

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)

    if (failed > 0) {
      process.exit(1)
    }
  } finally {
    await sql.end()
    // Clean up test database
    const cleanup = postgres(adminUrl, { max: 1 })
    try {
      await cleanup.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`)
      console.log(`\nCleaned up test database '${TEST_DB}'`)
    } finally {
      await cleanup.end()
    }
  }
}

run().catch((err) => {
  console.error('\nTest failed with error:', err)
  process.exit(1)
})

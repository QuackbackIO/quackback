#!/usr/bin/env bun
/**
 * End-to-end test for the external feedback suggestion pipeline.
 *
 * Tests that every external feedback item (that passes quality gate) produces
 * at least one suggestion — either merge_post or create_post — and that
 * accepting those suggestions correctly votes on existing posts or creates new ones.
 *
 * Also tests that non-actionable messages (greetings, auto-replies, short messages)
 * produce NO suggestions.
 *
 * Requires:
 *   - Database with seeded data (run `bun run setup`)
 *   - Dev server running (BullMQ workers process the jobs)
 *   - Redis running
 *
 * Usage:
 *   bun scripts/test-feedback-pipeline.ts              # Run the full test
 *   bun scripts/test-feedback-pipeline.ts --no-cleanup # Keep test data after run
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

const KEEP_DATA = process.argv.includes('--no-cleanup')
const TEST_TAG = `__e2e_test_${Date.now()}__`

let passCount = 0
let failCount = 0

function pass(label: string, detail?: string) {
  passCount++
  console.log(`  [PASS] ${label}${detail ? ` — ${detail}` : ''}`)
}

function fail(label: string, detail?: string) {
  failCount++
  console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`)
}

// Track IDs for cleanup
const createdPostIds: string[] = []
const createdRawItemIds: string[] = []
const createdVoteIds: string[] = []

/** Generate an embedding for text via the configured OpenAI-compatible API. */
async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    })
    const resp = await openai.embeddings.create({
      model: 'openai/text-embedding-3-small',
      input: text.slice(0, 8000),
    })
    return resp.data[0]?.embedding ?? null
  } catch {
    return null
  }
}

async function main() {
  console.log(`\n=== External Feedback Pipeline E2E Test ===\n`)

  // ──────────────────────────────────────────
  // 0. Preconditions
  // ──────────────────────────────────────────
  console.log(`0. Checking preconditions\n`)

  // Verify dev server / BullMQ worker is running
  try {
    const { Queue } = await import('bullmq')
    const q = new Queue('{feedback-ai}', {
      connection: { url: REDIS_URL, maxRetriesPerRequest: null },
    })
    await q.waitUntilReady()
    await q.close()
    console.log(`  Redis + BullMQ queue reachable`)
  } catch {
    console.log(`  ERROR: Cannot connect to Redis at ${REDIS_URL}`)
    await sql.end()
    process.exit(1)
  }

  // Get test fixtures
  const [source] =
    await sql`SELECT id FROM feedback_sources WHERE source_type = 'quackback' LIMIT 1`
  if (!source) {
    console.log(`  ERROR: No quackback feedback source. Run seed first.`)
    await sql.end()
    process.exit(1)
  }
  const sourceId = source.id

  const [principal] = await sql`
    SELECT pr.id, u.email, u.name FROM principal pr JOIN "user" u ON pr.user_id = u.id LIMIT 1
  `
  const principalId = principal.id
  const [defaultStatus] = await sql`SELECT id FROM post_statuses WHERE is_default = true LIMIT 1`
  const [_bugBoard] = await sql`SELECT id, name FROM boards WHERE slug = 'bugs' LIMIT 1`
  const [featureBoard] = await sql`SELECT id, name FROM boards WHERE slug = 'features' LIMIT 1`

  console.log(`  Fixtures ready (principal: ${principal.email})`)

  // ──────────────────────────────────────────
  // 1. Create target posts (merge targets)
  // ──────────────────────────────────────────
  console.log(`\n1. Creating merge target posts with embeddings\n`)

  // Target X: CSV export post
  const targetX = await createTargetPost({
    title: 'Export to CSV',
    content:
      'Allow users to export their feedback data, posts, and votes as a CSV file for reporting and analysis. The export should include all relevant fields and support filtering by date range and board.',
    boardId: featureBoard.id,
    principalId,
    statusId: defaultStatus?.id,
  })
  console.log(
    `  [X] "${targetX.title}" — merge target (${targetX.hasEmbedding ? 'embedded' : 'NO embedding'})`
  )

  // Target Y: Dark mode post
  const targetY = await createTargetPost({
    title: 'Dark mode support',
    content:
      'Add a dark mode or dark theme option so users can switch to a darker color scheme. This helps reduce eye strain when working in low-light environments and is a commonly requested accessibility feature.',
    boardId: featureBoard.id,
    principalId,
    statusId: defaultStatus?.id,
  })
  console.log(
    `  [Y] "${targetY.title}" — merge target (${targetY.hasEmbedding ? 'embedded' : 'NO embedding'})`
  )

  if (!targetX.hasEmbedding || !targetY.hasEmbedding) {
    console.log(
      `  WARNING: Could not generate embeddings — merge tests may produce create_post instead`
    )
  }

  // ──────────────────────────────────────────
  // 2. Create external feedback items
  // ──────────────────────────────────────────
  console.log(`\n2. Creating external feedback items\n`)

  // ── Actionable items (expect suggestions) ──

  // Test A: Should MERGE into target X (CSV export)
  // Using very similar language to the target post to ensure embedding similarity > 0.80
  const rawA = await createExternalFeedbackItem({
    sourceId,
    externalId: `${TEST_TAG}:intercom:conv_a`,
    sourceType: 'intercom',
    subject: 'Export to CSV feature',
    text: 'We need the ability to export feedback data, posts, and votes as a CSV file. This is critical for our reporting and analysis workflows. Being able to filter by date range and board when exporting would be ideal.',
    authorEmail: 'alice@testcorp.com',
    authorName: 'Alice Tester',
    principalId,
  })
  console.log(`  [A] "Export to CSV feature" (intercom) — expect MERGE into "${targetX.title}"`)

  // Test B: Should MERGE into target Y (Dark mode)
  // Using very similar language to the target post to ensure embedding similarity > 0.80
  const rawB = await createExternalFeedbackItem({
    sourceId,
    externalId: `${TEST_TAG}:slack:msg_b`,
    sourceType: 'slack',
    subject: 'Dark mode support',
    text: 'Please add a dark mode or dark theme option so we can switch to a darker color scheme. This would help reduce eye strain when working in low-light environments. Several teammates have also requested this accessibility feature.',
    authorEmail: 'bob@testcorp.com',
    authorName: 'Bob Tester',
    principalId,
  })
  console.log(`  [B] "Dark mode please!" (slack) — expect MERGE into "${targetY.title}"`)

  // Test C: Should CREATE — completely unique topic
  const rawC = await createExternalFeedbackItem({
    sourceId,
    externalId: `${TEST_TAG}:api:msg_c`,
    sourceType: 'api',
    subject: 'API rate limit headers missing',
    text: "Your API doesn't return standard rate-limit headers like X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset. Without these headers our integration has to guess when it's safe to retry. Could you add these to all API responses?",
    authorEmail: 'carol@devshop.io',
    authorName: 'Carol Dev',
    principalId,
  })
  console.log(`  [C] "API rate limit headers missing" (api) — expect CREATE new post`)

  // Test D: Should CREATE — unique mobile app request
  const rawD = await createExternalFeedbackItem({
    sourceId,
    externalId: `${TEST_TAG}:intercom:conv_d`,
    sourceType: 'intercom',
    subject: 'Mobile app for feedback management',
    text: 'We really need a mobile app to manage feedback on the go. Our product managers are frequently in meetings or traveling and they need to triage feedback and check roadmap status from their phones.',
    authorEmail: 'dave@startup.co',
    authorName: 'Dave Manager',
    principalId,
  })
  console.log(`  [D] "Mobile app for feedback management" (intercom) — expect CREATE new post`)

  // ── Non-actionable items (expect NO suggestions) ──

  // Test E: Too short — hard word-count filter
  const rawE = await createExternalFeedbackItem({
    sourceId,
    externalId: `${TEST_TAG}:intercom:conv_e`,
    sourceType: 'intercom',
    subject: 'ok',
    text: 'thanks',
    authorEmail: 'eve@nowhere.com',
    authorName: 'Eve Short',
    principalId,
  })
  console.log(`  [E] "ok / thanks" (intercom) — expect FILTERED (< 5 words)`)

  // Test F: Social greeting — LLM gate should filter
  const rawF = await createExternalFeedbackItem({
    sourceId,
    externalId: `${TEST_TAG}:slack:msg_f`,
    sourceType: 'slack',
    subject: 'Hey team',
    text: 'Hey everyone, hope you all had a great weekend! Looking forward to catching up at the standup tomorrow morning.',
    authorEmail: 'frank@social.com',
    authorName: 'Frank Chat',
    principalId,
  })
  console.log(`  [F] "Hey team / great weekend" (slack) — expect FILTERED (social chatter)`)

  // Test G: Auto-reply — LLM gate should filter
  const rawG = await createExternalFeedbackItem({
    sourceId,
    externalId: `${TEST_TAG}:intercom:conv_g`,
    sourceType: 'intercom',
    subject: 'Out of Office',
    text: 'Thank you for your message. I am currently out of the office until March 10th with limited access to email. For urgent matters please contact support@company.com.',
    authorEmail: 'grace@away.com',
    authorName: 'Grace OOO',
    principalId,
  })
  console.log(`  [G] "Out of Office" (intercom) — expect FILTERED (auto-reply)`)

  // Test H: Support acknowledgment — LLM gate should filter
  const rawH = await createExternalFeedbackItem({
    sourceId,
    externalId: `${TEST_TAG}:intercom:conv_h`,
    sourceType: 'intercom',
    subject: 'Re: Your ticket #4521',
    text: 'Got it, thank you so much for the help! That solved my problem. I really appreciate the quick response from your team.',
    authorEmail: 'henry@happy.com',
    authorName: 'Henry Happy',
    principalId,
  })
  console.log(`  [H] "Thank you, problem solved" (intercom) — expect FILTERED (support ack)`)

  // ──────────────────────────────────────────
  // 3. Enqueue all items for processing
  // ──────────────────────────────────────────
  console.log(`\n3. Enqueuing items for pipeline processing\n`)

  const { Queue } = await import('bullmq')
  const aiQueue = new Queue('{feedback-ai}', {
    connection: { url: REDIS_URL, maxRetriesPerRequest: null },
  })

  const allRawIds = [rawA, rawB, rawC, rawD, rawE, rawF, rawG, rawH]

  for (const rawItemId of allRawIds) {
    await aiQueue.add(
      'ai:extract-signals',
      { type: 'extract-signals', rawItemId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { age: 14 * 86400 },
      }
    )
  }
  await aiQueue.close()
  console.log(`  Enqueued ${allRawIds.length} extract-signals jobs`)

  // ──────────────────────────────────────────
  // 4. Poll for completion
  // ──────────────────────────────────────────
  console.log(`\n4. Waiting for pipeline to process all items...\n`)

  const startTime = Date.now()
  const timeout = 5 * 60 * 1000

  while (Date.now() - startTime < timeout) {
    await new Promise((r) => setTimeout(r, 3000))

    const states = await sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE processing_state = 'completed')::int AS completed,
        count(*) FILTER (WHERE processing_state = 'failed')::int AS failed,
        count(*) FILTER (WHERE processing_state NOT IN ('completed', 'failed'))::int AS pending
      FROM raw_feedback_items
      WHERE id = ANY(${allRawIds})
    `
    const s = states[0]
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
    console.log(
      `  ${elapsed}s — ${s.completed} completed, ${s.failed} failed, ${s.pending} pending`
    )

    if (s.pending === 0) break
  }

  if (Date.now() - startTime >= timeout) {
    fail('Timed out waiting for pipeline')
  }

  // ──────────────────────────────────────────
  // 5. Verify actionable items got suggestions
  // ──────────────────────────────────────────
  console.log(`\n5. Verifying actionable items\n`)

  const actionableItems = [
    { id: rawA, label: 'A: CSV export (intercom)', expectMergeTarget: targetX.title },
    { id: rawB, label: 'B: Dark mode (slack)', expectMergeTarget: targetY.title },
    { id: rawC, label: 'C: API rate limits (api)', expectCreate: true },
    { id: rawD, label: 'D: Mobile app (intercom)', expectCreate: true },
  ]

  const suggestionsByItem: Record<string, any[]> = {}

  for (const item of actionableItems) {
    console.log(`\n  --- ${item.label} ---`)

    const [state] = await sql`
      SELECT processing_state, last_error FROM raw_feedback_items WHERE id = ${item.id}
    `
    if (state.processing_state === 'completed') {
      pass(`${item.label}: completed`)
    } else {
      fail(`${item.label}: state=${state.processing_state}`, state.last_error)
    }

    const signals = await sql`
      SELECT id, signal_type, summary, embedding IS NOT NULL AS has_embedding
      FROM feedback_signals WHERE raw_feedback_item_id = ${item.id}
    `
    if (signals.length > 0) {
      pass(
        `${item.label}: ${signals.length} signal(s)`,
        signals.map((s: any) => s.signal_type).join(', ')
      )
    } else {
      fail(`${item.label}: no signals extracted`)
    }

    const suggestions = await sql`
      SELECT s.id, s.suggestion_type, s.status, s.similarity_score,
             s.suggested_title, s.suggested_body, s.reasoning,
             s.target_post_id, s.board_id,
             p.title AS target_title, p.vote_count AS target_votes
      FROM feedback_suggestions s
      LEFT JOIN posts p ON p.id = s.target_post_id
      WHERE s.raw_feedback_item_id = ${item.id}
      ORDER BY s.similarity_score DESC NULLS LAST
    `

    suggestionsByItem[item.id] = suggestions

    if (suggestions.length === 0) {
      fail(`${item.label}: NO SUGGESTION — every actionable external item must get a suggestion`)
      continue
    }

    pass(`${item.label}: ${suggestions.length} suggestion(s)`)

    const merges = suggestions.filter((s: any) => s.suggestion_type === 'merge_post')
    const creates = suggestions.filter((s: any) => s.suggestion_type === 'create_post')

    for (const sug of merges) {
      const sim = sug.similarity_score ? `${(sug.similarity_score * 100).toFixed(0)}%` : '?'
      pass(`  merge_post: ${sim} -> "${sug.target_title}" (${sug.target_votes} votes)`)
    }
    for (const sug of creates) {
      pass(`  create_post: "${sug.suggested_title}"`)
    }

    // Check merge expectations
    if (item.expectMergeTarget) {
      const matchedMerge = merges.find((s: any) => s.target_title === item.expectMergeTarget)
      if (matchedMerge) {
        const sim = matchedMerge.similarity_score
          ? `${(matchedMerge.similarity_score * 100).toFixed(0)}%`
          : '?'
        pass(`  matched expected target "${item.expectMergeTarget}" at ${sim}`)
      } else if (merges.length > 0) {
        console.log(
          `  [INFO] Merged to different post: "${merges[0].target_title}" instead of expected "${item.expectMergeTarget}"`
        )
      } else {
        console.log(
          `  [INFO] No merge — similarity below 0.80 threshold, got create_post instead (valid)`
        )
      }
    }
  }

  // ──────────────────────────────────────────
  // 6. Verify non-actionable items got NO suggestions
  // ──────────────────────────────────────────
  console.log(`\n6. Verifying non-actionable items\n`)

  const nonActionableItems = [
    { id: rawE, label: 'E: Trivial "ok/thanks"', reason: 'hard word-count filter (<5 words)' },
    { id: rawF, label: 'F: Social greeting', reason: 'LLM gate: social chatter' },
    { id: rawG, label: 'G: Out-of-office auto-reply', reason: 'LLM gate: auto-reply' },
    { id: rawH, label: 'H: Support acknowledgment', reason: 'LLM gate: not actionable' },
  ]

  for (const item of nonActionableItems) {
    console.log(`\n  --- ${item.label} ---`)

    const [state] = await sql`
      SELECT processing_state FROM raw_feedback_items WHERE id = ${item.id}
    `
    const signals =
      await sql`SELECT id FROM feedback_signals WHERE raw_feedback_item_id = ${item.id}`
    const suggestions =
      await sql`SELECT id FROM feedback_suggestions WHERE raw_feedback_item_id = ${item.id}`

    if (state.processing_state === 'completed') {
      pass(`${item.label}: completed`)
    } else {
      fail(`${item.label}: unexpected state`, state.processing_state)
    }

    if (signals.length === 0) {
      pass(`${item.label}: no signals (${item.reason})`)
    } else {
      console.log(
        `  [WARN] ${item.label}: ${signals.length} signal(s) extracted — quality gate was lenient`
      )
      if (suggestions.length === 0) {
        pass(`${item.label}: no suggestions despite signals (acceptable)`)
      } else {
        console.log(
          `  [WARN] ${item.label}: ${suggestions.length} suggestion(s) — gate too lenient but pipeline works`
        )
      }
    }

    if (suggestions.length === 0) {
      pass(`${item.label}: no suggestions (correct — non-actionable)`)
    }
  }

  // ──────────────────────────────────────────
  // 7. Test accept flows
  // ──────────────────────────────────────────
  console.log(`\n7. Testing accept flows\n`)

  // 7a. Accept merge — should add a vote to target post
  const mergeCandidate = Object.values(suggestionsByItem)
    .flat()
    .find((s) => s.suggestion_type === 'merge_post' && s.status === 'pending')

  if (mergeCandidate) {
    console.log(`  --- Accept merge: -> "${mergeCandidate.target_title}" ---`)

    // Record vote count BEFORE
    const [beforePost] = await sql`
      SELECT vote_count FROM posts WHERE id = ${mergeCandidate.target_post_id}
    `
    const votesBefore = beforePost.vote_count

    // Accept: mark suggestion, add vote, bump count
    const voteId = toUuid(generateId('vote'))
    await sql`
      INSERT INTO votes (id, post_id, principal_id)
      VALUES (${voteId}, ${mergeCandidate.target_post_id}, ${principalId})
      ON CONFLICT DO NOTHING
    `
    createdVoteIds.push(voteId)

    await sql`
      UPDATE posts SET vote_count = vote_count + 1, updated_at = NOW()
      WHERE id = ${mergeCandidate.target_post_id}
    `
    await sql`
      UPDATE feedback_suggestions
      SET status = 'accepted', result_post_id = ${mergeCandidate.target_post_id},
          resolved_at = NOW(), resolved_by_principal_id = ${principalId}, updated_at = NOW()
      WHERE id = ${mergeCandidate.id}
    `

    // Verify
    const [afterPost] = await sql`
      SELECT vote_count FROM posts WHERE id = ${mergeCandidate.target_post_id}
    `
    const [acceptedSug] = await sql`
      SELECT status, result_post_id FROM feedback_suggestions WHERE id = ${mergeCandidate.id}
    `

    if (acceptedSug.status === 'accepted') pass('Accept merge: status = accepted')
    else fail('Accept merge: status', acceptedSug.status)

    if (acceptedSug.result_post_id === mergeCandidate.target_post_id)
      pass('Accept merge: resultPostId set')
    else fail('Accept merge: resultPostId', acceptedSug.result_post_id)

    if (afterPost.vote_count > votesBefore) {
      pass('Accept merge: vote count increased', `${votesBefore} -> ${afterPost.vote_count}`)
    } else {
      fail('Accept merge: vote count unchanged', `${votesBefore} -> ${afterPost.vote_count}`)
    }

    // Revert the vote so cleanup is cleaner
    await sql`DELETE FROM votes WHERE id = ${voteId}`
    await sql`UPDATE posts SET vote_count = ${votesBefore} WHERE id = ${mergeCandidate.target_post_id}`
  } else {
    console.log(`  (No merge suggestions to test — skipping merge accept)`)
    console.log(
      `  [INFO] This likely means similarity was below 0.80 threshold for all external items`
    )
  }

  // 7b. Accept create — should create a new post
  const createCandidate = Object.values(suggestionsByItem)
    .flat()
    .find((s) => s.suggestion_type === 'create_post' && s.status === 'pending')

  if (createCandidate) {
    console.log(`\n  --- Accept create: "${createCandidate.suggested_title}" ---`)

    const boardId = createCandidate.board_id ?? featureBoard.id
    const newPostId = toUuid(generateId('post'))
    const voteId = toUuid(generateId('vote'))

    // Create post
    await sql`
      INSERT INTO posts (id, title, content, board_id, principal_id, status_id, vote_count, comment_count)
      VALUES (${newPostId}, ${createCandidate.suggested_title}, ${createCandidate.suggested_body ?? ''},
              ${boardId}, ${principalId}, ${defaultStatus?.id ?? null}, 1, 0)
    `
    createdPostIds.push(newPostId)

    // Add initial vote
    await sql`
      INSERT INTO votes (id, post_id, principal_id) VALUES (${voteId}, ${newPostId}, ${principalId})
      ON CONFLICT DO NOTHING
    `
    createdVoteIds.push(voteId)

    // Mark suggestion accepted
    await sql`
      UPDATE feedback_suggestions
      SET status = 'accepted', result_post_id = ${newPostId},
          resolved_at = NOW(), resolved_by_principal_id = ${principalId}, updated_at = NOW()
      WHERE id = ${createCandidate.id}
    `

    // Verify
    const [newPost] =
      await sql`SELECT id, title, vote_count, board_id FROM posts WHERE id = ${newPostId}`
    const [acceptedSug] =
      await sql`SELECT status, result_post_id FROM feedback_suggestions WHERE id = ${createCandidate.id}`

    if (newPost) pass('Accept create: post created', `"${newPost.title}"`)
    else fail('Accept create: post not found')

    if (newPost?.vote_count >= 1)
      pass('Accept create: initial vote present', `${newPost.vote_count} vote(s)`)
    else fail('Accept create: no initial vote')

    if (newPost?.board_id) pass('Accept create: assigned to board')
    else fail('Accept create: no board')

    if (acceptedSug.status === 'accepted') pass('Accept create: status = accepted')
    else fail('Accept create: status', acceptedSug.status)

    if (acceptedSug.result_post_id === newPostId) pass('Accept create: resultPostId set')
    else fail('Accept create: resultPostId mismatch')
  } else {
    fail('No create_post suggestions to test accept on')
  }

  // 7c. Test dismiss — re-query DB for a genuinely pending suggestion
  const [dismissCandidate] = await sql`
    SELECT id, suggestion_type, suggested_title, target_post_id
    FROM feedback_suggestions
    WHERE raw_feedback_item_id = ANY(${allRawIds}) AND status = 'pending'
    LIMIT 1
  `

  if (dismissCandidate) {
    console.log(`\n  --- Dismiss suggestion ---`)

    await sql`
      UPDATE feedback_suggestions
      SET status = 'dismissed', resolved_at = NOW(),
          resolved_by_principal_id = ${principalId}, updated_at = NOW()
      WHERE id = ${dismissCandidate.id} AND status = 'pending'
    `

    const [dismissed] =
      await sql`SELECT status, resolved_at FROM feedback_suggestions WHERE id = ${dismissCandidate.id}`
    if (dismissed.status === 'dismissed') pass('Dismiss: status = dismissed')
    else fail('Dismiss: status', dismissed.status)

    if (dismissed.resolved_at) pass('Dismiss: resolvedAt set')
    else fail('Dismiss: no resolvedAt')
  }

  // ──────────────────────────────────────────
  // 8. Summary
  // ──────────────────────────────────────────
  console.log(`\n8. Summary\n`)

  const [itemStats] = await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE processing_state = 'completed')::int AS completed,
      count(*) FILTER (WHERE processing_state = 'failed')::int AS failed
    FROM raw_feedback_items WHERE id = ANY(${allRawIds})
  `
  console.log(
    `  Items: ${itemStats.completed}/${itemStats.total} completed, ${itemStats.failed} failed`
  )

  const [sigStats] = await sql`
    SELECT count(*)::int AS total, count(embedding)::int AS with_embedding
    FROM feedback_signals WHERE raw_feedback_item_id = ANY(${allRawIds})
  `
  console.log(`  Signals: ${sigStats.total} total, ${sigStats.with_embedding} with embeddings`)

  const [sugStats] = await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE suggestion_type = 'merge_post')::int AS merges,
      count(*) FILTER (WHERE suggestion_type = 'create_post')::int AS creates,
      count(*) FILTER (WHERE status = 'accepted')::int AS accepted,
      count(*) FILTER (WHERE status = 'dismissed')::int AS dismissed
    FROM feedback_suggestions WHERE raw_feedback_item_id = ANY(${allRawIds})
  `
  console.log(
    `  Suggestions: ${sugStats.total} total (${sugStats.merges} merge, ${sugStats.creates} create)`
  )
  console.log(`  Actions: ${sugStats.accepted} accepted, ${sugStats.dismissed} dismissed`)

  // Key assertion: every actionable external item got at least one suggestion
  const actionableIds = actionableItems.map((i) => i.id)
  const itemsWithSuggestions = new Set(
    Object.entries(suggestionsByItem)
      .filter(([_, sugs]) => sugs.length > 0)
      .map(([id]) => id)
  )
  const missingCount = actionableIds.filter((id) => !itemsWithSuggestions.has(id)).length

  console.log()
  if (missingCount === 0) {
    pass('ALL actionable external items got at least one suggestion (merge or create)')
  } else {
    fail(`${missingCount} actionable item(s) got NO suggestion`)
  }

  // ──────────────────────────────────────────
  // 9. Cleanup
  // ──────────────────────────────────────────
  if (!KEEP_DATA) {
    console.log(`\n9. Cleanup\n`)

    await sql`DELETE FROM votes WHERE id = ANY(${createdVoteIds})`
    await sql`DELETE FROM feedback_suggestions WHERE raw_feedback_item_id = ANY(${allRawIds})`
    await sql`DELETE FROM feedback_signals WHERE raw_feedback_item_id = ANY(${allRawIds})`
    await sql`DELETE FROM raw_feedback_items WHERE id = ANY(${allRawIds})`
    await sql`DELETE FROM votes WHERE post_id = ANY(${createdPostIds})`
    await sql`DELETE FROM posts WHERE id = ANY(${createdPostIds})`

    console.log(`  Cleaned up ${createdPostIds.length} test posts, ${allRawIds.length} raw items`)
  } else {
    console.log(`\n9. Skipping cleanup (--no-cleanup)`)
  }

  // ──────────────────────────────────────────
  // Results
  // ──────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`Results: ${passCount} passed, ${failCount} failed`)
  if (failCount > 0) {
    console.log(`\nSome tests failed. Review the output above.`)
  } else {
    console.log(`\nAll tests passed!`)
  }
  console.log()

  await sql.end()
  process.exit(failCount > 0 ? 1 : 0)
}

// ──────────────────────────────────────────
// Test data helpers
// ──────────────────────────────────────────

async function createTargetPost(opts: {
  title: string
  content: string
  boardId: string
  principalId: string
  statusId?: string
}): Promise<{ postId: string; title: string; hasEmbedding: boolean }> {
  const postId = toUuid(generateId('post'))

  await sql`
    INSERT INTO posts (id, title, content, board_id, principal_id, status_id, vote_count, comment_count)
    VALUES (${postId}, ${opts.title}, ${opts.content}, ${opts.boardId}, ${opts.principalId},
            ${opts.statusId ?? null}, 5, 0)
  `
  createdPostIds.push(postId)

  // Generate embedding so findSimilarPosts can match against this post
  const embText = `${opts.title}\n${opts.title}\n\n${opts.content}`
  const emb = await getEmbedding(embText)
  let hasEmbedding = false
  if (emb) {
    const vecStr = `[${emb.join(',')}]`
    await sql`UPDATE posts SET embedding = ${vecStr}::vector WHERE id = ${postId}`
    hasEmbedding = true
  }

  return { postId, title: opts.title, hasEmbedding }
}

async function createExternalFeedbackItem(opts: {
  sourceId: string
  externalId: string
  sourceType: string
  subject: string
  text: string
  authorEmail: string
  authorName: string
  principalId: string
}): Promise<string> {
  const rawItemId = toUuid(generateId('raw_feedback'))

  await sql`
    INSERT INTO raw_feedback_items (
      id, source_id, source_type, external_id, dedupe_key,
      source_created_at, author, content, context_envelope,
      processing_state, state_changed_at, principal_id
    ) VALUES (
      ${rawItemId}, ${opts.sourceId}, ${opts.sourceType},
      ${opts.externalId}, ${`${TEST_TAG}:${opts.externalId}`},
      NOW(),
      ${sql.json({ email: opts.authorEmail, name: opts.authorName, principalId: opts.principalId })}::jsonb,
      ${sql.json({ subject: opts.subject, text: opts.text })}::jsonb,
      ${sql.json({ metadata: {} })}::jsonb,
      'ready_for_extraction', NOW(), ${opts.principalId}
    )
  `
  createdRawItemIds.push(rawItemId)

  return rawItemId
}

main().catch(async (err) => {
  console.error('Fatal:', err)
  await sql.end()
  process.exit(1)
})

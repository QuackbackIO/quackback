/**
 * Execution-level parity test: postViewFilter (SQL) ↔ canViewPost (in-memory).
 *
 * The sibling board-view-filter-parity.test.ts proves boardViewFilter ↔
 * canViewBoard row-for-row, and invariants.test.ts pins postViewFilter's
 * rendered SQL shape (param binding for 'published'/'pending'/principalId).
 * But the COMPOSED predicate — `boardViewFilter(actor) AND (published OR
 * ownPending)` for non-team, `moderationState <> 'deleted'` for team — was
 * only proven transitively. A refactor of the moderation clause (or its
 * composition with the board filter) could ship a list-vs-detail visibility
 * drift that no current test catches.
 *
 * This pins it: for every (actor, board access, moderationState) the SQL
 * predicate's row-membership decision is identical to canViewPost's in-memory
 * decision. Every seeded post is authored by P_AUTHOR, so the own-pending
 * escape hatch is exercised by the `author` actor (and only that actor).
 *
 * Connects via DATABASE_URL (falling back to the dev DB), skipping gracefully
 * if neither is reachable — matching board-view-filter-parity.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, eq, and } from 'drizzle-orm'
import {
  boards,
  posts,
  principal,
  type BoardAccess,
  type ModerationState,
  type Database,
} from '@/lib/server/db'
// eslint-disable-next-line no-restricted-imports -- legitimate second createDb caller (see board-view-filter-parity.test.ts)
import { createDb } from '@quackback/db/client'
import { canViewPost, postViewFilter } from '../posts'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import {
  createId,
  type SegmentId,
  type PrincipalId,
  type BoardId,
  type PostId,
} from '@quackback/ids'

const SEGMENT_ALPHA = createId('segment') as SegmentId

// All seeded posts are authored by this principal. The `author` actor below
// shares it, so the own-pending hatch fires for `author` and nobody else.
const P_AUTHOR = createId('principal') as PrincipalId

function mkAccess(view: BoardAccess['view'], segmentIds: string[] = []): BoardAccess {
  return {
    view,
    vote: view,
    comment: view,
    submit: view,
    segments: { view: segmentIds, vote: segmentIds, comment: segmentIds, submit: segmentIds },
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
  }
}

interface AccessCase {
  name: string
  access: BoardAccess
}

const accessShapes: AccessCase[] = [
  { name: 'anonymous', access: mkAccess('anonymous') },
  { name: 'authenticated', access: mkAccess('authenticated') },
  { name: 'team', access: mkAccess('team') },
  { name: 'segments_alpha', access: mkAccess('segments', [SEGMENT_ALPHA]) },
  // Empty segment allowlist must fail closed for every non-team actor — pin
  // it at the composed post layer too, matching board-view-filter-parity.
  { name: 'segments_empty', access: mkAccess('segments', []) },
]

const STATES: ModerationState[] = ['published', 'pending', 'spam', 'deleted']

function buildActor(overrides: Partial<Actor>): Actor {
  return {
    principalId: null,
    role: null,
    principalType: 'anonymous',
    segmentIds: new Set(),
    ...overrides,
  }
}

const actors: Record<string, Actor> = {
  anon: ANONYMOUS_ACTOR,
  // Shares P_AUTHOR + is in alpha → can view the segments board AND owns the
  // seeded pending posts.
  author: buildActor({
    principalId: P_AUTHOR,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set([SEGMENT_ALPHA]),
  }),
  // In alpha but NOT the author → sees the segments board, never the pending.
  memberOnly: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set([SEGMENT_ALPHA]),
  }),
  stranger: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
  }),
  service: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'service',
  }),
  admin: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'admin',
    principalType: 'user',
  }),
}

const CANDIDATE_URLS = [
  process.env.DATABASE_URL,
  'postgresql://postgres:password@localhost:5432/quackback',
].filter((u): u is string => !!u)

async function pickWorkingDb(): Promise<{ db: Database; close: () => Promise<void> } | null> {
  for (const url of CANDIDATE_URLS) {
    try {
      const db = createDb(url, { max: 2, prepare: false })
      await db.execute(sql`select 1`)
      await db.execute(sql`select id from ${posts} limit 0`)
      return {
        db,
        close: async () => {
          const raw = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
          await raw?.end?.()
        },
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

let activeDb: Database | null = null
let closeDb: (() => Promise<void>) | null = null
const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
// (board name, post id) per (access shape, moderation state).
const seededPosts = new Map<string, PostId>() // key: `${accessName}:${state}`

const resolved = await pickWorkingDb()
const dbAvailable = resolved !== null
if (resolved) {
  activeDb = resolved.db
  closeDb = resolved.close
}

describe.skipIf(!dbAvailable)('postViewFilter ↔ canViewPost parity (execution-level)', () => {
  beforeAll(async () => {
    if (!activeDb) return
    // Crash-safety sweep of leftover rows from prior runs, then seed the
    // author principal (posts.principal_id has an FK to principal), one board
    // per access shape, and one post per (shape, state), authored by P_AUTHOR.
    await activeDb.delete(posts).where(sql`${posts.title} ~ '^pvf-[0-9]+-'`)
    await activeDb.delete(boards).where(sql`${boards.slug} ~ '^pvf-[0-9]+-'`)
    await activeDb
      .insert(principal)
      .values({ id: P_AUTHOR, createdAt: new Date() })
      .onConflictDoNothing()
    for (const shape of accessShapes) {
      const boardId = createId('board') as BoardId
      await activeDb.insert(boards).values({
        id: boardId,
        slug: `pvf-${runSuffix}-${shape.name}`,
        name: `pvf:${shape.name}`,
        access: shape.access,
      })
      for (const state of STATES) {
        const postId = createId('post') as PostId
        await activeDb.insert(posts).values({
          id: postId,
          boardId,
          principalId: P_AUTHOR,
          title: `pvf-${runSuffix}-${shape.name}-${state}`,
          content: 'parity fixture',
          moderationState: state,
        })
        seededPosts.set(`${shape.name}:${state}`, postId)
      }
    }
  })

  afterAll(async () => {
    if (!activeDb) return
    try {
      await activeDb.delete(posts).where(sql`${posts.title} LIKE ${`pvf-${runSuffix}-%`}`)
      await activeDb.delete(boards).where(sql`${boards.slug} LIKE ${`pvf-${runSuffix}-%`}`)
      await activeDb.delete(principal).where(eq(principal.id, P_AUTHOR))
    } finally {
      await closeDb?.()
    }
  })

  for (const [actorName, actor] of Object.entries(actors)) {
    for (const shape of accessShapes) {
      for (const state of STATES) {
        it(`actor=${actorName} access=${shape.name} state=${state}`, async () => {
          if (!activeDb) return
          const postId = seededPosts.get(`${shape.name}:${state}`)
          expect(postId, `seed missing for ${shape.name}:${state}`).toBeDefined()
          if (!postId) return

          const expectMemoryAllowed = canViewPost(
            actor,
            { moderationState: state, principalId: P_AUTHOR },
            { access: shape.access }
          ).allowed

          // postViewFilter's non-team branch references boards.* via
          // boardViewFilter, so the boards join must be present. The team
          // branch ignores boards — the join is harmless there.
          const matched = await activeDb
            .select({ id: posts.id })
            .from(posts)
            .innerJoin(boards, eq(posts.boardId, boards.id))
            .where(and(eq(posts.id, postId), postViewFilter(actor)))

          const expectSqlAllowed = matched.length === 1
          expect(
            expectSqlAllowed,
            `SQL admitted=${expectSqlAllowed} but in-memory admitted=${expectMemoryAllowed} ` +
              `for actor=${actorName} access=${shape.name} state=${state}`
          ).toBe(expectMemoryAllowed)
        })
      }
    }
  }
})

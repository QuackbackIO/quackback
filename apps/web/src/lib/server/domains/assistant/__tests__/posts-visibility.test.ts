/**
 * Feedback-post visibility predicate coverage. The Agent's `posts` toggle
 * relaxes the customer-facing ceiling to public boards only (D8): a `public`
 * ceiling narrows to anonymous-viewable boards, while a `team` ceiling sees any
 * non-deleted board. Both ceilings exclude unpublished, merged, and deleted rows.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { sql, eq, and } from 'drizzle-orm'
import { boards, posts, principal, type BoardAccess, type Database } from '@/lib/server/db'
// eslint-disable-next-line no-restricted-imports -- legitimate second createDb caller (see board-view-filter-parity.test.ts)
import { createDb } from '@quackback/db/client'
import { postsVisibilityConditions } from '../posts-retrieval'
import { createId, type PrincipalId, type BoardId, type PostId } from '@quackback/ids'

const mockGenerateEmbedding = vi.hoisted(() => vi.fn())
const mockDbSelect = vi.hoisted(() => vi.fn())

vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: { select: (...args: unknown[]) => mockDbSelect(...args) },
  }
})

const P_AUTHOR = createId('principal') as PrincipalId

function mkAccess(view: BoardAccess['view']): BoardAccess {
  return {
    view,
    vote: view,
    comment: view,
    submit: view,
    segments: { view: [], vote: [], comment: [], submit: [] },
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
  }
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

const resolved = await pickWorkingDb()
const dbAvailable = resolved !== null
if (resolved) {
  activeDb = resolved.db
  closeDb = resolved.close
}

interface PostCase {
  name: string
  boardName: 'public' | 'restricted'
  moderationState: 'published' | 'pending'
  merged?: boolean
  deleted?: boolean
  /** Whether this row should be visible for the 'team' ceiling. */
  teamVisible: boolean
  /** Whether this row should be visible for the 'public' (Agent) ceiling —
   *  published rows on an anonymous-viewable board only (D8). */
  publicVisible: boolean
}

const cases: PostCase[] = [
  {
    name: 'published_public_board',
    boardName: 'public',
    moderationState: 'published',
    teamVisible: true,
    publicVisible: true,
  },
  {
    name: 'pending_public_board',
    boardName: 'public',
    moderationState: 'pending',
    teamVisible: false,
    publicVisible: false,
  },
  {
    name: 'merged_public_board',
    boardName: 'public',
    moderationState: 'published',
    merged: true,
    teamVisible: false,
    publicVisible: false,
  },
  {
    name: 'deleted_public_board',
    boardName: 'public',
    moderationState: 'published',
    deleted: true,
    teamVisible: false,
    publicVisible: false,
  },
  {
    name: 'published_restricted_board',
    boardName: 'restricted',
    moderationState: 'published',
    teamVisible: true,
    // A non-anonymous (team-access) board is never public-visible.
    publicVisible: false,
  },
]

const boardIds = new Map<string, BoardId>()
const postIds = new Map<string, PostId>()

describe('postsVisibilityConditions ceiling relaxation (D8)', () => {
  it('adds the anonymous-viewable board filter for the public ceiling only', () => {
    const publicConditions = postsVisibilityConditions('public')
    const teamConditions = postsVisibilityConditions('team')
    // The public ceiling carries exactly one extra predicate over the team
    // ceiling: the anonymous-viewable board narrowing (the Agent sees public
    // boards only, D8). Team sees any non-deleted board.
    expect(publicConditions.length).toBe(teamConditions.length + 1)
  })
})

describe.skipIf(!dbAvailable)('postsVisibilityConditions (execution-level)', () => {
  beforeAll(async () => {
    if (!activeDb) return
    await activeDb.delete(posts).where(sql`${posts.title} ~ '^pv-[0-9]+-'`)
    await activeDb.delete(boards).where(sql`${boards.slug} ~ '^pv-[0-9]+-'`)
    await activeDb
      .insert(principal)
      .values({ id: P_AUTHOR, createdAt: new Date() })
      .onConflictDoNothing()

    for (const boardName of ['public', 'restricted'] as const) {
      const boardId = createId('board') as BoardId
      await activeDb.insert(boards).values({
        id: boardId,
        slug: `pv-${runSuffix}-${boardName}`,
        name: `pv:${boardName}`,
        access: mkAccess(boardName === 'public' ? 'anonymous' : 'team'),
      })
      boardIds.set(boardName, boardId)
    }

    for (const c of cases) {
      const postId = createId('post') as PostId
      await activeDb.insert(posts).values({
        id: postId,
        boardId: boardIds.get(c.boardName)!,
        principalId: P_AUTHOR,
        title: `pv-${runSuffix}-${c.name}`,
        content: 'visibility fixture',
        moderationState: c.moderationState,
        canonicalPostId: c.merged ? (createId('post') as PostId) : null,
        deletedAt: c.deleted ? new Date() : null,
      })
      postIds.set(c.name, postId)
    }
  })

  afterAll(async () => {
    if (!activeDb) return
    try {
      await activeDb.delete(posts).where(sql`${posts.title} LIKE ${`pv-${runSuffix}-%`}`)
      await activeDb.delete(boards).where(sql`${boards.slug} LIKE ${`pv-${runSuffix}-%`}`)
      await activeDb.delete(principal).where(eq(principal.id, P_AUTHOR))
    } finally {
      await closeDb?.()
    }
  })

  for (const c of cases) {
    it(`case=${c.name} ceiling=team -> visible=${c.teamVisible}`, async () => {
      if (!activeDb) return
      const postId = postIds.get(c.name)
      expect(postId, `seed missing for ${c.name}`).toBeDefined()
      if (!postId) return

      const matched = await activeDb
        .select({ id: posts.id })
        .from(posts)
        .innerJoin(boards, eq(posts.boardId, boards.id))
        .where(and(eq(posts.id, postId), ...postsVisibilityConditions('team')))

      expect(matched.length === 1).toBe(c.teamVisible)
    })

    it(`case=${c.name} ceiling=public -> visible=${c.publicVisible}`, async () => {
      if (!activeDb) return
      const postId = postIds.get(c.name)
      expect(postId, `seed missing for ${c.name}`).toBeDefined()
      if (!postId) return

      const matched = await activeDb
        .select({ id: posts.id })
        .from(posts)
        .innerJoin(boards, eq(posts.boardId, boards.id))
        .where(and(eq(posts.id, postId), ...postsVisibilityConditions('public')))

      expect(matched.length === 1).toBe(c.publicVisible)
    })
  }
})

/**
 * fetchPortalData returns the viewer's voted post ids so the feed renders
 * vote highlights on first paint. The viewer is whoever the request's session
 * says it is. A user id in the request names nobody: votes are personal, and
 * the request is caller-controlled.
 *
 * Real Postgres for the votes; the session is the test's input, and the feed
 * lists around the votes are stubbed empty.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postVotes, posts, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import type { AuthContext } from '../auth-helpers'

const hoisted = vi.hoisted(() => ({ session: null as AuthContext | null }))

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler<T>(fn: T) {
        return fn
      },
    }
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('../portal-access', () => ({
  resolvePortalAccessForRequest: async () => ({ granted: true }),
}))
vi.mock('../auth-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth-helpers')>()),
  getOptionalAuth: async () => hoisted.session,
}))
vi.mock('@/lib/server/domains/boards/board.public', () => ({
  listPublicBoardsWithStats: async () => [],
  getPublicBoardBySlug: async () => null,
}))
vi.mock('@/lib/server/domains/posts/post.public', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/posts/post.public')>()),
  listPublicPostsWithVotesAndAvatars: async () => ({ items: [], hasMore: false }),
}))
vi.mock('@/lib/server/domains/statuses/status.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/statuses/status.service')>()),
  listPublicStatuses: async () => [],
}))
vi.mock('@/lib/server/domains/post-tags/post-tag.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/post-tags/post-tag.service')>()),
  listPublicPostTags: async () => [],
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  findSettingsCached: async () => ({ portalConfig: { features: { allowAnonymous: true } } }),
}))

const { fetchPortalData } = await import('../portal')

type PortalDataResult = { votedPostIds: string[]; principalId: string | null }
const callFetchPortalData = fetchPortalData as unknown as (args: {
  data: Record<string, unknown>
}) => Promise<PortalDataResult>

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: postVotes.id }).from(postVotes).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

interface Person {
  userId: UserId
  principalId: PrincipalId
  type: 'user' | 'anonymous'
}

async function seedPerson(name: string, type: Person['type'] = 'user'): Promise<Person> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, email: `${userId}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type,
    displayName: name,
    createdAt: new Date(),
  })
  return { userId, principalId, type }
}

async function seedPostVotedBy(boardId: BoardId, author: Person, voter: Person): Promise<PostId> {
  const [post] = await testDb
    .insert(posts)
    .values({ boardId, title: `Post ${suffix()}`, content: '', principalId: author.principalId })
    .returning()
  await testDb.insert(postVotes).values({ postId: post.id, principalId: voter.principalId })
  return post.id
}

function sessionFor(person: Person): AuthContext {
  return {
    settings: { id: 'workspace_test', slug: 'test', name: 'Test', logoKey: null },
    user: {
      id: person.userId,
      email: `${person.userId}@example.com`,
      name: 'Viewer',
      image: null,
    },
    principal: { id: person.principalId, role: 'user', type: person.type },
    permissions: [],
    scope: 'portal',
  } as AuthContext
}

describe.skipIf(!fixture.available)('fetchPortalData voted posts (real DB)', () => {
  let viewer: Person
  let other: Person
  let viewerVote: PostId
  let otherVote: PostId

  beforeEach(async () => {
    await fixture.begin()
    hoisted.session = null
    const [board] = await testDb
      .insert(boards)
      .values({ slug: `votes-${suffix()}`, name: 'Votes', access: DEFAULT_BOARD_ACCESS })
      .returning()
    viewer = await seedPerson('Viewer')
    other = await seedPerson('Someone else')
    viewerVote = await seedPostVotedBy(board.id, other, viewer)
    otherVote = await seedPostVotedBy(board.id, viewer, other)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("never returns another user's votes when the request names their user id", async () => {
    hoisted.session = sessionFor(viewer)

    const result = await callFetchPortalData({ data: { sort: 'top', userId: other.userId } })

    expect(result.votedPostIds).not.toContain(otherVote)
    expect(result.votedPostIds).toEqual([viewerVote])
    expect(result.principalId).toBe(viewer.principalId)
  })

  it('returns nothing to a visitor without a session, whatever user id the request names', async () => {
    const result = await callFetchPortalData({ data: { sort: 'top', userId: other.userId } })

    expect(result.votedPostIds).toEqual([])
    expect(result.principalId).toBeNull()
  })

  it("returns the signed-in viewer's own votes from the session", async () => {
    hoisted.session = sessionFor(viewer)

    const result = await callFetchPortalData({ data: { sort: 'top' } })

    expect(result.votedPostIds).toEqual([viewerVote])
    expect(result.principalId).toBe(viewer.principalId)
  })

  it("returns an anonymous visitor's own votes from their session", async () => {
    const anon = await seedPerson('Anonymous', 'anonymous')
    const [board] = await testDb
      .insert(boards)
      .values({ slug: `anon-${suffix()}`, name: 'Anon', access: DEFAULT_BOARD_ACCESS })
      .returning()
    const anonVote = await seedPostVotedBy(board.id, viewer, anon)
    hoisted.session = sessionFor(anon)

    const result = await callFetchPortalData({ data: { sort: 'top' } })

    expect(result.votedPostIds).toEqual([anonVote])
    expect(result.principalId).toBe(anon.principalId)
  })
})

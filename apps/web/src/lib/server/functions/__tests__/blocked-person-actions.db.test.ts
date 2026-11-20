// @vitest-environment node
/**
 * A blocked person cannot post, vote, comment or react on the portal or in the
 * widget (owner decision D7). The portal and widget server functions share the
 * `run*` bodies driven here, against real Postgres; every write rolls back.
 *
 * Each refusal is the typed `BLOCKED` error and leaves no row behind. The same
 * person, unblocked, votes and comments through the same calls (the control),
 * so the refusal is the block and nothing else.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostCommentId,
  type PostId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  postCommentReactions,
  postComments,
  postStatuses,
  posts,
  postVotes,
  principal,
  settings,
  user,
  type BoardAccess,
} from '@/lib/server/db'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings/settings.types'
import type { AuthContext } from '../auth-helpers'

const effects = vi.hoisted(() => ({ headers: new Headers() }))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@tanstack/react-start', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start')>()),
  createServerOnlyFn: <T>(fn: T) => fn,
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => effects.headers }))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  findSettingsCached: async () => testDb.query.settings.findFirst(),
}))
vi.mock('@/lib/server/domains/settings/settings.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.service')>()),
  getPortalConfig: async () => {
    const row = await testDb.query.settings.findFirst()
    return { ...DEFAULT_PORTAL_CONFIG, ...JSON.parse(row!.portalConfig!) }
  },
}))

const fixture = await createDbTestFixture()

const open: BoardAccess = {
  view: 'anonymous',
  submit: 'authenticated',
  vote: 'authenticated',
  comment: 'authenticated',
  segments: { view: [], submit: [], vote: [], comment: [] },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
}

let personId: PrincipalId
let boardId: BoardId
let postId: PostId
let commentId: PostCommentId
let auth: AuthContext

async function block(): Promise<void> {
  await testDb.update(principal).set({ blockedAt: new Date() }).where(eq(principal.id, personId))
}

async function countFor(table: typeof postVotes | typeof postCommentReactions): Promise<number> {
  const rows = await testDb.select().from(table).where(eq(table.principalId, personId))
  return rows.length
}

async function commentsBy(): Promise<number> {
  const rows = await testDb
    .select({ id: postComments.id })
    .from(postComments)
    .where(eq(postComments.principalId, personId))
  return rows.length
}

async function postsBy(): Promise<number> {
  const rows = await testDb
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.principalId, personId))
  return rows.length
}

describe.skipIf(!fixture.available)('a blocked person on the portal and in the widget', () => {
  beforeEach(async () => {
    await fixture.begin()
    effects.headers = new Headers()

    const existing = await testDb.query.settings.findFirst()
    const portalConfig = JSON.stringify(DEFAULT_PORTAL_CONFIG)
    if (existing) {
      await testDb.update(settings).set({ portalConfig }).where(eq(settings.id, existing.id))
    } else {
      await testDb.insert(settings).values({
        name: 'Acme',
        slug: `acme-${createId('user')}`,
        createdAt: new Date(),
        portalConfig,
      })
    }
    const workspace = (await testDb.query.settings.findFirst())!

    const authorUser = createId('user') as UserId
    const authorId = createId('principal') as PrincipalId
    await testDb
      .insert(user)
      .values({ id: authorUser, name: 'Kaye', email: `kaye+${authorUser}@example.com` })
    await testDb.insert(principal).values({
      id: authorId,
      userId: authorUser,
      role: 'user',
      type: 'user',
      createdAt: new Date(),
    })

    const personUser = createId('user') as UserId
    personId = createId('principal') as PrincipalId
    await testDb
      .insert(user)
      .values({ id: personUser, name: 'Riley', email: `riley+${personUser}@example.com` })
    await testDb.insert(principal).values({
      id: personId,
      userId: personUser,
      role: 'user',
      type: 'user',
      displayName: 'Riley',
      createdAt: new Date(),
    })

    boardId = createId('board') as BoardId
    await testDb
      .insert(boards)
      .values({ id: boardId, name: 'Ideas', slug: `ideas-${boardId}`, access: open })
    await testDb
      .insert(postStatuses)
      .values({ name: 'Open', slug: 'open', isDefault: true })
      .onConflictDoNothing()
    postId = createId('post') as PostId
    await testDb
      .insert(posts)
      .values({ id: postId, boardId, title: 'Dark mode', content: 'Please', principalId: authorId })
    commentId = createId('post_comment') as PostCommentId
    await testDb
      .insert(postComments)
      .values({ id: commentId, postId, principalId: authorId, content: 'Agreed' })

    auth = {
      settings: { id: workspace.id, slug: workspace.slug, name: workspace.name, logoKey: null },
      user: {
        id: personUser,
        name: 'Riley',
        email: `riley+${personUser}@example.com`,
        image: null,
      },
      principal: { id: personId, role: 'user', type: 'user' },
      permissions: [],
      scope: 'portal',
    }
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  const refused = { code: 'BLOCKED', statusCode: 403 }

  it('cannot vote', async () => {
    await block()
    const { runToggleVote } = await import('../public-posts')
    await expect(runToggleVote(auth, { postId })).rejects.toMatchObject(refused)
    expect(await countFor(postVotes)).toBe(0)
  })

  it('may take back a vote given before the block, and no more', async () => {
    const { runToggleVote } = await import('../public-posts')
    await runToggleVote(auth, { postId })
    await block()
    await expect(runToggleVote(auth, { postId })).resolves.toMatchObject({ voted: false })
    expect(await countFor(postVotes)).toBe(0)
    await expect(runToggleVote(auth, { postId })).rejects.toMatchObject(refused)
    expect(await countFor(postVotes)).toBe(0)
  })

  it('a teammate is never refused, even with a block left on their row', async () => {
    await testDb
      .update(principal)
      .set({ role: 'member', blockedAt: new Date() })
      .where(eq(principal.id, personId))
    const { runCreateComment } = await import('../comments')
    await runCreateComment(auth, { postId, content: 'From the team' })
    expect(await commentsBy()).toBe(1)
  })

  it('cannot submit a post', async () => {
    await block()
    const { runCreatePublicPost } = await import('../public-posts')
    await expect(
      runCreatePublicPost(auth, { boardId, title: 'Spam', content: 'Spam' })
    ).rejects.toMatchObject(refused)
    expect(await postsBy()).toBe(0)
  })

  it('cannot comment', async () => {
    await block()
    const { runCreateComment } = await import('../comments')
    await expect(runCreateComment(auth, { postId, content: 'Spam' })).rejects.toMatchObject(refused)
    expect(await commentsBy()).toBe(0)
  })

  it('cannot react to a comment, nor take a reaction back', async () => {
    await testDb
      .insert(postCommentReactions)
      .values({ commentId, principalId: personId, emoji: '👍' })
    await block()
    const { runAddReaction, runRemoveReaction } = await import('../comments')
    await expect(runAddReaction(auth, { commentId, emoji: '🎉' })).rejects.toMatchObject(refused)
    await expect(runRemoveReaction(auth, { commentId, emoji: '👍' })).rejects.toMatchObject(refused)
    expect(await countFor(postCommentReactions)).toBe(1)
  })

  it('unblocked, the same person votes, comments and reacts (the control)', async () => {
    const { runToggleVote } = await import('../public-posts')
    const { runCreateComment, runAddReaction } = await import('../comments')
    await expect(runToggleVote(auth, { postId })).resolves.toMatchObject({ voted: true })
    await runCreateComment(auth, { postId, content: 'Me too' })
    await runAddReaction(auth, { commentId, emoji: '🎉' })
    expect(await countFor(postVotes)).toBe(1)
    expect(await commentsBy()).toBe(1)
    expect(await countFor(postCommentReactions)).toBe(1)
  })
})

/**
 * A blocked portal user reaching MCP in their own name (an OAuth grant) gets
 * the same refusal as on the portal (owner decision D7): no new vote, post,
 * comment or reaction. Taking back a vote they already gave still works,
 * since that is leaving rather than taking part. Real Postgres; every write
 * rolls back.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/server'
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
  posts,
  postVotes,
  principal,
  settings,
  user,
  type BoardAccess,
} from '@/lib/server/db'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings/settings.types'
import type { McpAuthContext } from '../types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

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

import { registerPostTools } from '../tools/posts'
import { registerCommentTools } from '../tools/comments'

const fixture = await createDbTestFixture()

const open: BoardAccess = {
  view: 'anonymous',
  submit: 'authenticated',
  vote: 'authenticated',
  comment: 'authenticated',
  segments: { view: [], submit: [], vote: [], comment: [] },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
}

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

function tools(auth: McpAuthContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const server = {
    registerTool: (name: string, _c: unknown, handler: Handler) => void handlers.set(name, handler),
  }
  registerPostTools(server as never, auth)
  registerCommentTools(server as never, auth)
  return handlers
}

function text(result: CallToolResult): string {
  return result.content.map((part) => ('text' in part ? part.text : '')).join('\n')
}

let personId: PrincipalId
let boardId: BoardId
let postId: PostId
let commentId: PostCommentId
let auth: McpAuthContext

const rowsBy = async (table: typeof postVotes | typeof postCommentReactions) =>
  (await testDb.select().from(table).where(eq(table.principalId, personId))).length

if (fixture.available) {
  beforeEach(async () => {
    await fixture.begin()
    const portalConfig = JSON.stringify(DEFAULT_PORTAL_CONFIG)
    const existing = await testDb.query.settings.findFirst()
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
      createdAt: new Date(),
    })
    boardId = createId('board') as BoardId
    await testDb
      .insert(boards)
      .values({ id: boardId, name: 'Ideas', slug: `ideas-${boardId}`, access: open })
    postId = createId('post') as PostId
    await testDb
      .insert(posts)
      .values({ id: postId, boardId, title: 'Dark mode', content: 'Please', principalId: authorId })
    commentId = createId('post_comment') as PostCommentId
    await testDb
      .insert(postComments)
      .values({ id: commentId, postId, principalId: authorId, content: 'Agreed' })
    auth = {
      principalId: personId,
      userId: personUser,
      name: 'Riley',
      email: `riley+${personUser}@example.com`,
      role: 'user',
      authMethod: 'oauth',
      scopes: ['read:feedback', 'write:feedback'],
    }
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

async function block(): Promise<void> {
  await testDb.update(principal).set({ blockedAt: new Date() }).where(eq(principal.id, personId))
}

describe.skipIf(!fixture.available)('MCP tools for a blocked portal user', () => {
  it('refuses a new vote, post, comment and reaction, writing nothing', async () => {
    await block()
    const t = tools(auth)
    const calls: Array<[string, Record<string, unknown>]> = [
      ['vote_post', { postId }],
      ['create_post', { boardId, title: 'Spam' }],
      ['add_comment', { postId, content: 'Spam' }],
      ['react_to_comment', { action: 'add', commentId, emoji: '🎉' }],
    ]
    for (const [name, args] of calls) {
      const result = await t.get(name)!(args)
      expect(result.isError, name).toBe(true)
      expect(text(result), name).toContain("You can't post, vote or comment here.")
    }
    expect(await rowsBy(postVotes)).toBe(0)
    expect(await rowsBy(postCommentReactions)).toBe(0)
    const own = await testDb.select().from(posts).where(eq(posts.principalId, personId))
    expect(own).toHaveLength(0)
    const comments = await testDb
      .select()
      .from(postComments)
      .where(eq(postComments.principalId, personId))
    expect(comments).toHaveLength(0)
  })

  it('lets them take back a vote they gave before the block', async () => {
    const t = tools(auth)
    const voted = await t.get('vote_post')!({ postId })
    expect(voted.isError).toBeFalsy()
    expect(await rowsBy(postVotes)).toBe(1)

    await block()
    const unvoted = await t.get('vote_post')!({ postId })
    expect(unvoted.isError).toBeFalsy()
    expect(JSON.parse(text(unvoted))).toMatchObject({ postId, voted: false })
    expect(await rowsBy(postVotes)).toBe(0)

    // With nothing left to take back, voting again is refused.
    const again = await t.get('vote_post')!({ postId })
    expect(again.isError).toBe(true)
    expect(await rowsBy(postVotes)).toBe(0)
  })

  it('unblocked, the same person votes and comments (the control)', async () => {
    const t = tools(auth)
    expect((await t.get('vote_post')!({ postId })).isError).toBeFalsy()
    const commented = await t.get('add_comment')!({ postId, content: 'Me too' })
    expect(commented.isError, text(commented)).toBeFalsy()
    expect(await rowsBy(postVotes)).toBe(1)
  })
})

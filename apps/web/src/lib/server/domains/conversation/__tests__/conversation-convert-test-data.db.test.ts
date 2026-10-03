import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type ConversationId,
  type PostId,
  type PrincipalId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  conversations,
  postExternalLinks,
  posts,
  principal,
  user,
  eq,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import type { Actor } from '@/lib/server/policy/types'

const mutations = vi.hoisted(() => ({
  createPost: vi.fn(),
  addVoteOnBehalf: vi.fn(),
  createComment: vi.fn(),
  sendAgentMessage: vi.fn(),
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'http://localhost:3100/' } }))
vi.mock('../conversation.service', async (original) => ({
  ...(await original<typeof import('../conversation.service')>()),
  sendAgentMessage: mutations.sendAgentMessage,
}))
vi.mock('@/lib/server/domains/posts/post.service', () => ({ createPost: mutations.createPost }))
vi.mock('@/lib/server/domains/posts/post.voting', () => ({
  addVoteOnBehalf: mutations.addVoteOnBehalf,
}))
vi.mock('@/lib/server/domains/comments/comment.service', () => ({
  createComment: mutations.createComment,
}))

import { getOrCreateTestCustomer } from '@/lib/server/test-customer'
import { createPostFromConversation } from '../conversation.convert'

const fixture = await createDbTestFixture()
let owner: PrincipalId,
  customer: PrincipalId,
  ordinary: PrincipalId,
  boardId: BoardId,
  postId: PostId
let actor: Actor

type CreatePostArgs = Parameters<
  typeof import('@/lib/server/domains/posts/post.service').createPost
>
type AddVoteArgs = Parameters<
  typeof import('@/lib/server/domains/posts/post.voting').addVoteOnBehalf
>
type CreateCommentArgs = Parameters<
  typeof import('@/lib/server/domains/comments/comment.service').createComment
>
type SendAgentMessageArgs = Parameters<typeof import('../conversation.service').sendAgentMessage>

async function expectSeededPrincipal(id: PrincipalId) {
  expect([owner, customer, ordinary]).toContain(id)
  expect(await testDb.query.principal.findFirst({ where: eq(principal.id, id) })).toMatchObject({
    id,
  })
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  vi.clearAllMocks()
  owner = createId('principal')
  ordinary = createId('principal')
  boardId = createId('board')
  postId = createId('post')
  const ownerUser = createId('user')
  await testDb.insert(user).values({ id: ownerUser, name: 'Acme', email: 'you@example.com' })
  await testDb.insert(principal).values([
    { id: owner, userId: ownerUser, type: 'user', role: 'admin', createdAt: new Date() },
    { id: ordinary, type: 'anonymous', role: 'user', createdAt: new Date() },
  ])
  customer = (await getOrCreateTestCustomer(owner, 'en')).id
  actor = { principalId: owner, principalType: 'user', role: 'admin', segmentIds: new Set() }
  await testDb
    .insert(boards)
    .values({ id: boardId, name: 'Feedback', slug: String(boardId), access: DEFAULT_BOARD_ACCESS })
  await testDb.insert(posts).values({
    id: postId,
    boardId,
    principalId: ordinary,
    title: 'Acme',
    content: '',
    voteCount: 1,
  })
  mutations.createPost.mockImplementation(async (...[input, author]: CreatePostArgs) => {
    expect(input).toMatchObject({ boardId, title: 'Acme', content: 'A test idea' })
    expect(input.widgetMetadata).toMatchObject({ source: 'live_chat' })
    expect(input.widgetMetadata?.conversationId).toBeDefined()
    expect(author.actor).toEqual(actor)
    await expectSeededPrincipal(author.principalId)
    const stored = await testDb.query.posts.findFirst({ where: eq(posts.id, postId) })
    return { id: stored!.id, boardSlug: String(input.boardId) }
  })
  mutations.addVoteOnBehalf.mockImplementation(
    async (...[selectedPost, voter, source, agent]: AddVoteArgs) => {
      expect(selectedPost).toBe(postId)
      await expectSeededPrincipal(voter)
      expect(agent).toBe(owner)
      expect(source?.type).toBe('live_chat')
      const link = new URL(source!.externalUrl)
      expect(link.pathname).toBe('/admin/inbox')
      expect(
        await testDb.query.conversations.findFirst({
          where: eq(conversations.id, link.searchParams.get('i') as ConversationId),
        })
      ).toMatchObject({ visitorPrincipalId: voter })
      const stored = await testDb.query.posts.findFirst({ where: eq(posts.id, selectedPost) })
      return { voted: true, voteCount: stored!.voteCount }
    }
  )
  mutations.createComment.mockImplementation(
    async (...[input, author, acting]: CreateCommentArgs) => {
      expect(input).toMatchObject({ postId, isPrivate: true })
      expect(input.content).toContain('A test message')
      expect(author.principalId).toBe(owner)
      expect(acting).toEqual(actor)
      await expectSeededPrincipal(author.principalId)
      return { id: createId('post_comment'), postId: input.postId }
    }
  )
  mutations.sendAgentMessage.mockImplementation(
    async (...[id, content, agent, acting, attachments, doc]: SendAgentMessageArgs) => {
      expect(
        await testDb.query.conversations.findFirst({ where: eq(conversations.id, id) })
      ).toMatchObject({ id })
      expect(content).toBe('')
      expect(agent.principalId).toBe(owner)
      expect(acting).toEqual(actor)
      expect(attachments).toBeUndefined()
      expect(doc).toEqual({
        type: 'doc',
        content: [{ type: 'quackbackEmbed', attrs: { kind: 'post', id: postId } }],
      })
      return { message: { id: createId('conversation_message'), conversationId: id, content } }
    }
  )
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function seed(
  visitorPrincipalId: PrincipalId,
  customAttributes: Record<string, unknown>
): Promise<ConversationId> {
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId, channel: 'messenger', customAttributes })
    .returning()
  return conversation.id
}

function convert(conversationId: ConversationId, mode: 'create' | 'upvote') {
  return createPostFromConversation(
    {
      conversationId,
      boardId,
      title: 'Acme',
      content: 'A test idea',
      ...(mode === 'upvote'
        ? { asUpvoteOfPostId: postId, sourceMessageContent: 'A test message' }
        : {}),
    },
    {
      agentActor: actor,
      agentPrincipalId: owner,
      agent: { principalId: owner, displayName: 'Acme', avatarUrl: null, email: 'you@example.com' },
    }
  )
}

it.each(['create', 'upvote'] as const)(
  'rejects %s from a durable test customer even without the marker',
  async (mode) => {
    const conversationId = await seed(customer, {})
    await expect(convert(conversationId, mode)).rejects.toMatchObject({
      code: 'CANNOT_CONVERT_TEST_CONVERSATION',
    })
    expect(mutations.createPost).not.toHaveBeenCalled()
    expect(mutations.addVoteOnBehalf).not.toHaveBeenCalled()
    expect(mutations.createComment).not.toHaveBeenCalled()
    expect(mutations.sendAgentMessage).not.toHaveBeenCalled()
    expect(
      await testDb.query.postExternalLinks.findMany({
        where: eq(postExternalLinks.externalId, conversationId),
      })
    ).toHaveLength(0)
    expect((await testDb.query.posts.findFirst({ where: eq(posts.id, postId) }))!.voteCount).toBe(1)
  }
)

it.each([
  ['create', true],
  ['upvote', 'true'],
] as const)(
  'converts a teammate thread carrying a legacy test attribute (%s, %s) as real',
  async (mode, test) => {
    // Decision 1: only the test customer's identity is test; a client-written
    // attribute and a teammate's own thread are ordinary data.
    const conversationId = await seed(owner, { test, testOwnerPrincipalId: owner })
    await expect(convert(conversationId, mode)).resolves.toMatchObject({ postId })
    expect(
      await testDb.query.postExternalLinks.findMany({
        where: eq(postExternalLinks.externalId, conversationId),
      })
    ).toHaveLength(1)
  }
)

it.each(['create', 'upvote'] as const)(
  'preserves ordinary %s conversion and its durable link',
  async (mode) => {
    const conversationId = await seed(ordinary, {})
    const result = await convert(conversationId, mode)
    expect(result).toMatchObject({ postId, created: mode === 'create' })
    const links = await testDb.query.postExternalLinks.findMany({
      where: eq(postExternalLinks.externalId, conversationId),
    })
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      postId,
      integrationType: 'live_chat',
      externalId: conversationId,
    })
    if (mode === 'create') {
      expect(mutations.createPost).toHaveBeenCalledWith(
        expect.objectContaining({
          boardId,
          title: 'Acme',
          widgetMetadata: { source: 'live_chat', conversationId },
        }),
        { principalId: ordinary, actor }
      )
      expect(mutations.addVoteOnBehalf).not.toHaveBeenCalled()
    } else {
      expect(mutations.addVoteOnBehalf).toHaveBeenCalledWith(
        postId,
        ordinary,
        expect.objectContaining({ type: 'live_chat' }),
        owner
      )
      expect(mutations.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          postId,
          isPrivate: true,
          content: expect.stringContaining('A test message'),
        }),
        expect.objectContaining({ principalId: owner }),
        actor
      )
      expect(mutations.createPost).not.toHaveBeenCalled()
    }
    expect(mutations.sendAgentMessage).toHaveBeenCalledWith(
      conversationId,
      '',
      expect.objectContaining({ principalId: owner }),
      actor,
      undefined,
      expect.any(Object)
    )
  }
)

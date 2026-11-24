/**
 * The AI agent's capture_feedback tool turns a customer's feature request into
 * a feedback post on a real customer-support turn. It runs autonomously under
 * the agent's own bounded actor (quinnActor), so the agent's permission
 * ceiling must hold both permissions the tool declares, post.create and
 * post.vote_on_behalf; without them the permission check denies every call
 * and no post is created.
 *
 * Real tool spec, real pipeline, real actor and real Postgres (rolled back);
 * only outbound side effects (realtime, webhooks, event dispatch, auto-tagging,
 * image rehosting) are stubbed.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type ConversationId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  conversations,
  eq,
  postExternalLinks,
  posts,
  postStatuses,
  principal,
  settings,
} from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/config', async () =>
  (await import('@/lib/server/__tests__/conversation-visibility-mocks')).configMocks()
)
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishConversationMessage: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))
vi.mock('@/lib/server/domains/conversation/conversation.webhooks', () => ({
  emitConversationCreated: vi.fn(),
  emitMessageCreated: vi.fn(),
  emitMessageNoteCreated: vi.fn(),
  emitMessageDeleted: vi.fn(),
  emitConversationStatusChanged: vi.fn(),
  emitConversationAssigned: vi.fn(),
  emitConversationPriorityChanged: vi.fn(),
  emitConversationCsatSubmitted: vi.fn(),
  emitConversationCsatCommentAdded: vi.fn(),
}))
vi.mock('@/lib/server/domains/channels', () => ({
  requireChannelAdapter: () => ({
    deliverLifecycleEvent: vi.fn(async () => {}),
    deliverMessage: vi.fn(async () => {}),
  }),
}))
vi.mock('@/lib/server/domains/posts/post.service', async (original) => {
  const actual = await original<typeof import('@/lib/server/domains/posts/post.service')>()
  return {
    ...actual,
    createPost: (...args: Parameters<typeof actual.createPost>) =>
      actual.createPost(args[0], args[1], { ...args[2], skipDispatch: true }),
  }
})
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  findSettingsCached: async () => testDb.query.settings.findFirst(),
}))
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: async (json: unknown) => json,
}))
vi.mock('@/lib/server/domains/posts/post.autotag', () => ({
  autoTagPost: async () => [],
}))

import { assembleAssistantToolset } from '../assistant.tools'
import { makeAssistantToolContext, ASSISTANT_TOOL_SPECS } from '../assistant.toolspec'
import { quinnActor } from '../assistant.actor'

const fixture = await createDbTestFixture()

let assistant: PrincipalId
let visitor: PrincipalId
let board: BoardId

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  assistant = createId('principal')
  visitor = createId('principal')
  board = createId('board')
  await testDb.insert(principal).values([
    { id: assistant, type: 'service', role: 'member', displayName: 'Agent', createdAt: new Date() },
    { id: visitor, type: 'anonymous', role: 'user', createdAt: new Date() },
  ])
  // A board with the access a new board gets by default.
  await testDb.insert(boards).values({ id: board, name: 'Ideas', slug: `ideas-${board}` })
  await testDb
    .insert(postStatuses)
    .values({ name: 'Open', slug: 'open', isDefault: true })
    .onConflictDoNothing()
  if (!(await testDb.query.settings.findFirst())) {
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: `acme-${board}`, createdAt: new Date() })
  }
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function openConversation(): Promise<ConversationId> {
  const [row] = await testDb
    .insert(conversations)
    .values({
      visitorPrincipalId: visitor,
      channel: 'messenger',
      status: 'open',
      customAttributes: {},
    })
    .returning()
  return row!.id
}

describe('capture_feedback on a customer-support turn', () => {
  it('creates a post attributed to the customer under the AI agent’s own actor', async () => {
    const conversationId = await openConversation()
    const ctx = makeAssistantToolContext({
      db: testDb,
      assistantPrincipalId: assistant,
      audience: 'public',
      conversationId,
      role: 'customer_support',
      writeToolPolicy: 'execute',
      simulate: false,
    })
    // The context defaults to the agent's bounded actor; pin that here so the
    // test cannot pass under a broader one.
    expect(ctx.actor).toEqual(quinnActor(assistant))

    const { tools } = await assembleAssistantToolset(ctx)
    const captureFeedback = tools.find((t) => t.name === 'capture_feedback')
    expect(captureFeedback?.execute).toBeDefined()

    const out = await captureFeedback!.execute!(
      { boardId: board, title: 'Dark mode for the dashboard', content: 'Asked in chat.' },
      { context: ctx, emitCustomEvent: () => {} } as never
    )

    expect(out).toMatchObject({ created: true })
    const postId = (out as { postId: string }).postId
    const post = await testDb.query.posts.findFirst({ where: eq(posts.id, postId as never) })
    expect(post).toMatchObject({
      boardId: board,
      title: 'Dark mode for the dashboard',
      principalId: visitor,
      moderationState: 'published',
    })
    const link = await testDb.query.postExternalLinks.findFirst({
      where: eq(postExternalLinks.externalId, conversationId),
    })
    expect(link?.postId).toBe(postId)
  })

  it('is the only built-in tool that the post.create and post.vote_on_behalf grants unlock', () => {
    const declaring = (key: string) =>
      Object.values(ASSISTANT_TOOL_SPECS)
        .filter((spec) => (spec.permissions as readonly string[]).includes(key))
        .map((spec) => spec.name)
    expect(declaring(PERMISSIONS.POST_CREATE)).toEqual(['capture_feedback'])
    expect(declaring(PERMISSIONS.POST_VOTE_ON_BEHALF)).toEqual(['capture_feedback'])
  })
})

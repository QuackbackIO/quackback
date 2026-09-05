import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest'
import { generateId } from '@quackback/ids'
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
import { testDb, createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import { principal, posts, boards, conversations, conversationMessages } from '@/lib/server/db'
import { makeAssistantToolContext } from '../../assistant.toolspec'
import { executeListFeedback, executeFeedbackStats } from '../feedback-tools'
import { workspaceConversationSource } from '../../workspace-retrieval'
const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select().from(posts).limit(0)
  },
})
describe.skipIf(!fixture.available)('workspace reads with real DB', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)
  const context = () =>
    makeAssistantToolContext({
      db: testDb,
      assistantPrincipalId: generateId('principal'),
      audience: 'team',
      role: 'workspace_assistant',
      conversationId: null,
      workspaceThreadKey: 'test',
      knowledge: { sources: new Set(['post']), status: false },
    })
  it('lists and aggregates citable post IDs while excluding deleted posts', async () => {
    const [author] = await testDb
      .insert(principal)
      .values({ type: 'anonymous', role: 'user', createdAt: new Date() })
      .returning()
    const [board] = await testDb
      .insert(boards)
      .values({ name: 'Test board', slug: `test-${generateId('board')}` })
      .returning()
    const [post] = await testDb
      .insert(posts)
      .values({
        boardId: board.id,
        principalId: author.id,
        title: 'CSV request',
        content: 'Export feedback',
        voteCount: 7,
      })
      .returning()
    await testDb.insert(posts).values({
      boardId: board.id,
      principalId: author.id,
      title: 'Deleted',
      content: 'Gone',
      voteCount: 100,
      deletedAt: new Date(),
    })
    const ctx = context()
    const list = await executeListFeedback({ boardSlug: board.slug }, ctx)
    expect(list.items.map((item) => item.id)).toEqual([post.id])
    expect(ctx.ledger.sources.get(post.id)?.url).toContain(post.id)
    const stats = await executeFeedbackStats({ groupBy: 'board' }, ctx)
    const group = stats.groups.find((group) => group.postId === post.id)
    expect(group).toMatchObject({ count: 1, votes: 7 })
    expect(group?.url).toContain(post.id)
  })
  it('fails closed for public audience even with the workspace role', async () => {
    const ctx = context()
    ctx.audience = 'public'
    expect(await executeListFeedback({}, ctx)).toEqual({ items: [] })
    expect(await executeFeedbackStats({ groupBy: 'board' }, ctx)).toEqual({ groups: [] })
    expect(
      await workspaceConversationSource(true).retrieve('billing', 'public', { topK: 5 })
    ).toEqual([])
  })
  it('searches across customers only on the explicit team adapter and honors internal-note controls', async () => {
    const [author] = await testDb
      .insert(principal)
      .values({ type: 'anonymous', role: 'user', createdAt: new Date() })
      .returning()
    const [conversation] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: author.id, channel: 'messenger', subject: 'Billing' })
      .returning()
    await testDb.insert(conversationMessages).values({
      conversationId: conversation.id,
      principalId: author.id,
      senderType: 'visitor',
      content: 'Billing payment question',
      isInternal: false,
    })
    await testDb.insert(conversationMessages).values({
      conversationId: conversation.id,
      principalId: author.id,
      senderType: 'agent',
      content: 'Confidential billing investigation',
      isInternal: true,
    })
    expect(
      await workspaceConversationSource(false).retrieve('confidential', 'team', { topK: 5 })
    ).toEqual([])
    const items = await workspaceConversationSource(true, true).retrieve(
      'confidential billing',
      'team',
      { topK: 5 }
    )
    expect(items[0]).toMatchObject({ id: conversation.id, citation: { internal: true } })
    expect(items[0]?.citation.url).toContain(`?i=${conversation.id}`)
  })
})

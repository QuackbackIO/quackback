/**
 * What the post summary model is shown: the post and its public, published
 * comments. A private team note or a comment held for moderation never
 * reaches the prompt, so it cannot surface in keyQuotes (which REST and MCP
 * return), and the stored comment count matches what the sweep compares it to.
 *
 * Real Postgres in a rolled-back transaction; the model call is captured.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postComments, posts, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const prompts = vi.hoisted(() => [] as string[])

vi.mock('@/lib/server/domains/settings/cloud/entitlements', () => ({
  requireEntitlement: async () => undefined,
  hasEntitlement: async () => true,
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: async () => undefined,
  aiBudgetAvailable: async () => true,
}))
vi.mock('@/lib/server/config', () => ({
  config: { openaiApiKey: 'test-key', openaiBaseUrl: 'http://localhost:9999/v1' },
}))
vi.mock('@/lib/server/domains/ai/config', () => ({
  isAiClientConfigured: () => true,
}))
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: () => 'test-model',
}))
vi.mock('@/lib/server/domains/ai/structured-chat', () => ({
  structuredChat: async (args: { messages: { content: string }[] }) => {
    prompts.push(args.messages[0].content)
    return {
      summary: 'A summary',
      urgency: 'low',
      keyQuotes: [],
      nextSteps: [],
    }
  },
}))

const { generateAndSavePostSummary } = await import('../summary.service')

const fixture = await createDbTestFixture()
const tag = Math.random().toString(36).slice(2, 8)

describe.skipIf(!fixture.available)('summary input (real DB)', () => {
  let postId: PostId
  let author: PrincipalId

  beforeEach(async () => {
    await fixture.begin()
    prompts.length = 0
    const userId = createId('user') as UserId
    author = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: userId, name: `Admin ${tag}`, email: `s-${tag}@x.io` })
    await testDb
      .insert(principal)
      .values({ id: author, userId, role: 'admin', type: 'user', createdAt: new Date() })
    const boardId = createId('board') as BoardId
    await testDb.insert(boards).values({ id: boardId, name: `B ${tag}`, slug: `sum-${tag}` })
    postId = createId('post') as PostId
    await testDb
      .insert(posts)
      .values({ id: postId, boardId, title: `Post ${tag}`, content: 'body', principalId: author })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function comment(content: string, extra: Partial<typeof postComments.$inferInsert> = {}) {
    await testDb
      .insert(postComments)
      .values({ postId, principalId: author, content, isTeamMember: true, ...extra })
  }

  it('leaves private notes and held comments out of the prompt', async () => {
    await comment(`public-${tag}`)
    await comment(`secret-${tag}`, { isPrivate: true })
    await comment(`held-${tag}`, { moderationState: 'pending' })

    await generateAndSavePostSummary(postId)

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain(`public-${tag}`)
    expect(prompts[0]).not.toContain(`secret-${tag}`)
    expect(prompts[0]).not.toContain(`held-${tag}`)
    const [row] = await testDb
      .select({ count: posts.summaryCommentCount })
      .from(posts)
      .where(eq(posts.id, postId))
    expect(row.count).toBe(1)
  })

  it('starts afresh, without the stored summary, when the post has a comment it leaves out', async () => {
    // A summary stored before private notes were left out may quote one.
    await testDb
      .update(posts)
      .set({
        summaryJson: {
          summary: 'Old',
          keyQuotes: [`leaked-${tag}`],
          nextSteps: [],
        },
      })
      .where(eq(posts.id, postId))
    await comment(`public-${tag}`)
    await comment(`secret-${tag}`, { isPrivate: true })

    await generateAndSavePostSummary(postId)

    expect(prompts[0]).not.toContain(`leaked-${tag}`)
    expect(prompts[0]).not.toContain('Previous Summary')
  })

  it('keeps the stored summary for continuity when every comment is public', async () => {
    await testDb
      .update(posts)
      .set({
        summaryJson: { summary: 'Old', keyQuotes: [`kept-${tag}`], nextSteps: [] },
      })
      .where(eq(posts.id, postId))
    await comment(`public-${tag}`)

    await generateAndSavePostSummary(postId)

    expect(prompts[0]).toContain(`kept-${tag}`)
  })
})

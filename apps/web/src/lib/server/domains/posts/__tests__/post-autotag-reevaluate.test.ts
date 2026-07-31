/**
 * AI tag re-evaluation: saving a changed AI prompt on a tag re-runs that tag
 * against the workspace's recent posts. Posts matched this way are assigned
 * with the AI-applied marker (`auto_tagged`) so admins can review them.
 *
 * Pure unit test, no real DB — mirrors post-autotag-backfill.test.ts's
 * mocking idiom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId, PostTagId } from '@quackback/ids'

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: 'test-key' as string | undefined,
  openaiBaseUrl: 'http://localhost:9999/v1' as string | undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const mockChat = vi.fn()
vi.mock('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
}))
vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: (...args: unknown[]) => ({ kind: 'text', args }),
}))

vi.mock('@/lib/server/domains/ai/config', () => ({
  isAiClientConfigured: (apiKey?: string, baseUrl?: string) => Boolean(apiKey) && Boolean(baseUrl),
  structuredOutputProviderOptions: () => ({}),
}))

vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: () => ({ name: 'ai-usage-logging' }),
}))

vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: (_feature: string) => 'test-classify-model',
}))

vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: vi.fn(async () => undefined),
}))

// DB stub. Three read shapes flow through db.select: the tag lookup and
// autoTagPost's candidate-tag read (where() awaited directly) and the recent
// posts scan (where().orderBy().limit()). from() branches on the table marker.
const tagRows: { value: Array<{ id: string; name: string; aiPrompt: string | null }> } = {
  value: [],
}
const recentPosts: { value: Array<{ id: string; title: string; content: string }> } = { value: [] }
const insertedAssignments: Array<{ postId: string; tagId: string; autoTagged?: boolean }> = []

const postsTable = vi.hoisted(() => ({
  id: 'id',
  title: 'title',
  content: 'content',
  boardId: 'board_id',
  createdAt: 'created_at',
  deletedAt: 'deleted_at',
}))
vi.mock('@/lib/server/db', async () => {
  const { and, eq, isNull, isNotNull, asc, desc, notExists } =
    await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  const selectChain = () => ({
    from: vi.fn((table: unknown) => {
      if (table === postsTable) {
        return {
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => recentPosts.value),
            })),
          })),
        }
      }
      return { where: vi.fn(async () => tagRows.value) }
    }),
  })
  return {
    and,
    eq,
    isNull,
    isNotNull,
    asc,
    desc,
    notExists,
    db: {
      select: vi.fn(selectChain),
      insert: vi.fn(() => ({
        values: vi.fn((rows: Array<{ postId: string; tagId: string; autoTagged?: boolean }>) => {
          insertedAssignments.push(...rows)
          return { onConflictDoNothing: vi.fn(async () => undefined) }
        }),
      })),
    },
    posts: postsTable,
    postTags: { id: 'id', name: 'name', aiPrompt: 'ai_prompt', deletedAt: 'deleted_at' },
    postTagAssignments: { postId: 'post_id', tagId: 'tag_id' },
  }
})

import { reevaluateAiTag } from '../post.autotag'

const BUG_TAG = { id: 'post_tag_bug', name: 'Bug', aiPrompt: 'Reports of broken behavior' }
const POST_A = { id: 'post_a', title: 'Export button crashes', content: 'Clicking export throws' }
const POST_B = { id: 'post_b', title: 'Please add dark mode', content: 'A dark theme would help' }

beforeEach(() => {
  vi.clearAllMocks()
  insertedAssignments.length = 0
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  tagRows.value = [BUG_TAG]
  recentPosts.value = [{ ...POST_A }, { ...POST_B }]
  mockChat.mockResolvedValue({ matches: [] })
})

describe('reevaluateAiTag', () => {
  it('re-applies the tag to recent posts that match, marked as AI-applied', async () => {
    mockChat.mockResolvedValueOnce({ matches: ['Bug'] }).mockResolvedValueOnce({ matches: [] })

    const result = await reevaluateAiTag(BUG_TAG.id as PostTagId)

    expect(mockChat).toHaveBeenCalledTimes(2)
    expect(insertedAssignments).toEqual([
      { postId: POST_A.id as PostId, tagId: BUG_TAG.id as PostTagId, autoTagged: true },
    ])
    expect(result).toEqual({ scanned: 2, tagged: 1 })
  })

  it('evaluates against only the saved tag, not every prompted tag', async () => {
    mockChat.mockResolvedValue({ matches: ['Bug'] })

    await reevaluateAiTag(BUG_TAG.id as PostTagId)

    const prompt = mockChat.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('"Bug"')
    expect(prompt).toContain(BUG_TAG.aiPrompt)
  })

  it('does nothing when the tag has no AI prompt', async () => {
    tagRows.value = [{ ...BUG_TAG, aiPrompt: null }]

    const result = await reevaluateAiTag(BUG_TAG.id as PostTagId)

    expect(result).toEqual({ scanned: 0, tagged: 0 })
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('does nothing when the tag does not exist', async () => {
    tagRows.value = []

    const result = await reevaluateAiTag(BUG_TAG.id as PostTagId)

    expect(result).toEqual({ scanned: 0, tagged: 0 })
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('degrades to zero tags when the AI client is not configured', async () => {
    mockConfig.openaiApiKey = undefined

    const result = await reevaluateAiTag(BUG_TAG.id as PostTagId)

    expect(result).toEqual({ scanned: 2, tagged: 0 })
    expect(mockChat).not.toHaveBeenCalled()
    expect(insertedAssignments).toEqual([])
  })

  it('keeps scanning when a completion fails for one post', async () => {
    mockChat
      .mockRejectedValueOnce(new Error('upstream timeout'))
      .mockResolvedValueOnce({ matches: ['Bug'] })

    const result = await reevaluateAiTag(BUG_TAG.id as PostTagId)

    expect(result).toEqual({ scanned: 2, tagged: 1 })
    expect(insertedAssignments).toEqual([
      { postId: POST_B.id as PostId, tagId: BUG_TAG.id as PostTagId, autoTagged: true },
    ])
  })
})

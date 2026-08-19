/**
 * AI auto-tag backfill: an admin applies the AI-prompted tags to a board's
 * existing untagged posts in one action. Each post is evaluated through the
 * same `autoTagPost` gate as new posts, so every fallback (AI unconfigured,
 * budget exhausted, completion failure, hallucinated match) degrades to
 * "no tags added" for that post without failing the batch.
 *
 * Pure unit test, no real DB — mirrors post-autotag.test.ts's mocking idiom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BoardId, PostId } from '@quackback/ids'

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

// DB stub. Two read shapes flow through db.select: the untagged-post scan
// (where().orderBy().limit()) and autoTagPost's candidate-tag read plus the
// not-exists subquery (where() awaited directly). from() branches on the
// table marker.
const candidateTags: { value: Array<{ id: string; name: string; aiPrompt: string | null }> } = {
  value: [],
}
const untaggedPosts: { value: Array<{ id: string; title: string; content: string }> } = {
  value: [],
}
const insertedAssignments: Array<{ postId: string; tagId: string }> = []

const postsTable = vi.hoisted(() => ({
  id: 'id',
  title: 'title',
  content: 'content',
  boardId: 'board_id',
}))
vi.mock('@/lib/server/db', async () => {
  const { and, eq, isNull, isNotNull, asc, notExists } =
    await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  const selectChain = () => ({
    from: vi.fn((table: unknown) => {
      if (table === postsTable) {
        return {
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => untaggedPosts.value),
            })),
          })),
        }
      }
      return { where: vi.fn(async () => candidateTags.value) }
    }),
  })
  return {
    and,
    eq,
    isNull,
    isNotNull,
    asc,
    notExists,
    db: {
      select: vi.fn(selectChain),
      insert: vi.fn(() => ({
        values: vi.fn((rows: Array<{ postId: string; tagId: string }>) => {
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

import { backfillAiTagsForBoard } from '../post.autotag'

const BOARD_ID = 'board_1' as BoardId
const BUG_TAG = { id: 'post_tag_bug', name: 'Bug', aiPrompt: 'Reports of broken behavior' }

const POST_A = { id: 'post_a', title: 'Export button crashes', content: 'Clicking export throws' }
const POST_B = { id: 'post_b', title: 'Please add dark mode', content: 'A dark theme would help' }

beforeEach(() => {
  vi.clearAllMocks()
  insertedAssignments.length = 0
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  candidateTags.value = [BUG_TAG]
  untaggedPosts.value = [{ ...POST_A }, { ...POST_B }]
  mockChat.mockResolvedValue({ matches: [] })
})

describe('backfillAiTagsForBoard', () => {
  it('applies AI-prompted tags to the board’s untagged posts and reports the outcome', async () => {
    mockChat.mockResolvedValueOnce({ matches: ['Bug'] }).mockResolvedValueOnce({ matches: [] })

    const result = await backfillAiTagsForBoard(BOARD_ID)

    expect(mockChat).toHaveBeenCalledTimes(2)
    expect(insertedAssignments).toEqual([
      { postId: POST_A.id as PostId, tagId: BUG_TAG.id, autoTagged: true },
    ])
    expect(result).toEqual({ scanned: 2, tagged: 1, hasMore: false })
  })

  it('bounds the batch and reports that untagged posts remain', async () => {
    untaggedPosts.value = [{ ...POST_A }, { ...POST_B }]
    mockChat.mockResolvedValue({ matches: ['Bug'] })

    const result = await backfillAiTagsForBoard(BOARD_ID, 1)

    expect(mockChat).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ scanned: 1, tagged: 1, hasMore: true })
  })

  it('does nothing when the board has no untagged posts', async () => {
    untaggedPosts.value = []

    const result = await backfillAiTagsForBoard(BOARD_ID)

    expect(result).toEqual({ scanned: 0, tagged: 0, hasMore: false })
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('degrades to zero tags when the AI client is not configured', async () => {
    mockConfig.openaiApiKey = undefined

    const result = await backfillAiTagsForBoard(BOARD_ID)

    expect(result).toEqual({ scanned: 2, tagged: 0, hasMore: false })
    expect(mockChat).not.toHaveBeenCalled()
    expect(insertedAssignments).toEqual([])
  })

  it('keeps scanning when a completion fails for one post', async () => {
    mockChat
      .mockRejectedValueOnce(new Error('upstream timeout'))
      .mockResolvedValueOnce({ matches: ['Bug'] })

    const result = await backfillAiTagsForBoard(BOARD_ID)

    expect(result).toEqual({ scanned: 2, tagged: 1, hasMore: false })
    expect(insertedAssignments).toEqual([
      { postId: POST_B.id as PostId, tagId: BUG_TAG.id, autoTagged: true },
    ])
  })
})

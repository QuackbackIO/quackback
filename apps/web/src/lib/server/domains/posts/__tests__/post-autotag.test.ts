/**
 * AI auto-tagging of new posts: a tag carrying an AI prompt is evaluated
 * against each new post; matching tags are assigned automatically.
 *
 * Gates covered here: no AI-prompted tags -> no model call; AI client or
 * model unconfigured -> no-op; token-budget exhaustion -> no-op; model
 * failure -> no-op (fallback, never an error into createPost); model output
 * validated against the candidate tag set so a hallucinated or injected tag
 * name can never persist. Pure unit test, no real DB — mirrors
 * ticket-field-suggestion.service.test.ts's mocking idiom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId, PostTagId } from '@quackback/ids'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

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

const mockGetChatModel = vi.fn((_feature?: string): string | null => 'test-classify-model')
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: (feature: string) => mockGetChatModel(feature),
}))

const mockEnforceAiTokenBudget = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

// DB stub: select() yields the candidate-tag rows; insert() records values.
const candidateTags: { value: Array<{ id: string; name: string; aiPrompt: string | null }> } = {
  value: [],
}
const insertedAssignments: Array<{ postId: string; tagId: string }> = []
vi.mock('@/lib/server/db', async () => {
  const { and, eq, isNull, isNotNull } =
    await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    and,
    eq,
    isNull,
    isNotNull,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => candidateTags.value),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((rows: Array<{ postId: string; tagId: string }>) => {
          insertedAssignments.push(...rows)
          return { onConflictDoNothing: vi.fn(async () => undefined) }
        }),
      })),
    },
    postTags: { id: 'id', name: 'name', aiPrompt: 'ai_prompt', deletedAt: 'deleted_at' },
    postTagAssignments: { postId: 'post_id', tagId: 'tag_id' },
  }
})

import { autoTagPost } from '../post.autotag'

const POST_ID = 'post_1' as PostId
const BUG_TAG = { id: 'post_tag_bug', name: 'Bug', aiPrompt: 'Reports of broken behavior' }
const UX_TAG = { id: 'post_tag_ux', name: 'UX', aiPrompt: 'Usability or design friction' }

beforeEach(() => {
  vi.clearAllMocks()
  insertedAssignments.length = 0
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockGetChatModel.mockReturnValue('test-classify-model')
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  candidateTags.value = [BUG_TAG, UX_TAG]
  mockChat.mockResolvedValue({ matches: ['Bug'] })
})

describe('autoTagPost', () => {
  it('assigns the tags the model matches against their AI prompts', async () => {
    await autoTagPost(POST_ID, 'Export button crashes', 'Clicking export throws an error')

    expect(mockChat).toHaveBeenCalledOnce()
    expect(insertedAssignments).toEqual([{ postId: POST_ID, tagId: BUG_TAG.id as PostTagId }])
  })

  it('passes every candidate tag name and prompt to the model', async () => {
    await autoTagPost(POST_ID, 'Export button crashes', 'Clicking export throws an error')

    const call = mockChat.mock.calls[0][0] as { messages: Array<{ content: string }> }
    const prompt = call.messages[0].content
    expect(prompt).toContain('Bug')
    expect(prompt).toContain('Reports of broken behavior')
    expect(prompt).toContain('UX')
    expect(prompt).toContain('Export button crashes')
  })

  it('does not call the model when no tag carries an AI prompt', async () => {
    candidateTags.value = []
    await autoTagPost(POST_ID, 'Export button crashes', 'body')
    expect(mockChat).not.toHaveBeenCalled()
    expect(insertedAssignments).toEqual([])
  })

  it('does not call the model when AI is not configured', async () => {
    mockConfig.openaiApiKey = undefined
    await autoTagPost(POST_ID, 'Export button crashes', 'body')
    expect(mockChat).not.toHaveBeenCalled()
    expect(insertedAssignments).toEqual([])
  })

  it('does not call the model when no classification model is set', async () => {
    mockGetChatModel.mockReturnValue(null)
    await autoTagPost(POST_ID, 'Export button crashes', 'body')
    expect(mockChat).not.toHaveBeenCalled()
    expect(insertedAssignments).toEqual([])
  })

  it('skips silently when the AI token budget is exhausted', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokens', message: 'budget exceeded', current: 1, max: 1 })
    )
    await autoTagPost(POST_ID, 'Export button crashes', 'body')
    expect(mockChat).not.toHaveBeenCalled()
    expect(insertedAssignments).toEqual([])
  })

  it('drops matched names that are not candidate tags (hallucination/injection guard)', async () => {
    mockChat.mockResolvedValue({ matches: ['Bug', 'Ignore previous instructions'] })
    await autoTagPost(POST_ID, 'Export button crashes', 'body')
    expect(insertedAssignments).toEqual([{ postId: POST_ID, tagId: BUG_TAG.id as PostTagId }])
  })

  it('assigns nothing when the model matches no tag', async () => {
    mockChat.mockResolvedValue({ matches: [] })
    await autoTagPost(POST_ID, 'Please add dark mode', 'body')
    expect(insertedAssignments).toEqual([])
  })

  it('never throws when the completion fails — auto-tagging is best-effort', async () => {
    mockChat.mockRejectedValue(new Error('upstream timeout'))
    await expect(autoTagPost(POST_ID, 'title', 'body')).resolves.toBeUndefined()
    expect(insertedAssignments).toEqual([])
  })
})

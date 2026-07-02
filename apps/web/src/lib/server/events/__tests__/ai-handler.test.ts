import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aiHook } from '../handlers/ai'
import type { EventData } from '../types'

const mocks = vi.hoisted(() => ({
  analyzeSentiment: vi.fn(),
  saveSentiment: vi.fn(),
  generatePostEmbedding: vi.fn(),
  claimHookDelivery: vi.fn(),
  dbSelect: vi.fn(),
  eq: vi.fn(),
  logDebug: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}))

vi.mock('@/lib/server/domains/sentiment/sentiment.service', () => ({
  analyzeSentiment: (...args: unknown[]) => mocks.analyzeSentiment(...args),
  saveSentiment: (...args: unknown[]) => mocks.saveSentiment(...args),
}))

vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generatePostEmbedding: (...args: unknown[]) => mocks.generatePostEmbedding(...args),
}))

vi.mock('../hook-idempotency', () => ({
  claimHookDelivery: (...args: unknown[]) => mocks.claimHookDelivery(...args),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (...args: unknown[]) => mocks.dbSelect(...args),
  },
  postTags: {
    postId: 'postTags.postId',
    tagId: 'postTags.tagId',
  },
  tags: {
    id: 'tags.id',
    name: 'tags.name',
  },
  eq: (...args: unknown[]) => mocks.eq(...args),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      debug: (...args: unknown[]) => mocks.logDebug(...args),
      error: (...args: unknown[]) => mocks.logError(...args),
      info: (...args: unknown[]) => mocks.logInfo(...args),
      warn: (...args: unknown[]) => mocks.logWarn(...args),
    }),
  },
}))

function selectRows(rows: ReadonlyArray<Record<string, unknown>>) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(async () => rows),
  }
  return chain
}

function postCreatedEvent(): EventData {
  return {
    id: 'evt-post-created',
    type: 'post.created',
    timestamp: '2026-06-16T00:00:00.000Z',
    actor: { type: 'user', principalId: 'principal_1' },
    data: {
      post: {
        id: 'post_1',
        title: 'Import CSV support',
        content: 'Customers want CSV import support.',
      },
    },
  } as EventData
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.claimHookDelivery.mockResolvedValue(true)
  mocks.analyzeSentiment.mockResolvedValue({ sentiment: 'positive', confidence: 0.8 })
  mocks.saveSentiment.mockResolvedValue(undefined)
  mocks.generatePostEmbedding.mockResolvedValue(true)
  mocks.dbSelect.mockReturnValue(selectRows([]))
})

describe('aiHook', () => {
  it('adds post tag names to embedding generation', async () => {
    mocks.dbSelect.mockReturnValueOnce(selectRows([{ name: 'billing' }, { name: 'enterprise' }]))

    await expect(aiHook.run(postCreatedEvent(), {}, {}, { jobId: 'job_1' })).resolves.toEqual({
      success: true,
    })

    expect(mocks.claimHookDelivery).toHaveBeenCalledWith('job_1', 'ai')
    expect(mocks.generatePostEmbedding).toHaveBeenCalledWith(
      'post_1',
      'Import CSV support',
      'Customers want CSV import support.',
      ['billing', 'enterprise']
    )
    expect(mocks.logDebug).toHaveBeenCalledWith(
      { post_id: 'post_1', tag_count: 2, tags: ['billing', 'enterprise'] },
      'including tags in embedding'
    )
  })

  it('skips duplicate job executions before sentiment or embedding work', async () => {
    mocks.claimHookDelivery.mockResolvedValue(false)

    await expect(aiHook.run(postCreatedEvent(), {}, {}, { jobId: 'job_1' })).resolves.toEqual({
      success: true,
    })

    expect(mocks.analyzeSentiment).not.toHaveBeenCalled()
    expect(mocks.generatePostEmbedding).not.toHaveBeenCalled()
  })
})

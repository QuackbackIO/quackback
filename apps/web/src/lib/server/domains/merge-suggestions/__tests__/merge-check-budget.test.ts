/**
 * A workspace whose plan has no AI (or whose token budget is spent) is refused
 * by every merge check. The sweep must not grind through the backlog logging an
 * error per post, and failed rows stay stale, so it would repeat every run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId } from '@quackback/ids'

const h = vi.hoisted(() => ({
  findCandidates: vi.fn(),
  assess: vi.fn(),
  limit: vi.fn(),
  postFindFirst: vi.fn(),
  budgetAvailable: vi.fn(),
  expire: vi.fn(async () => 0),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => h.log },
}))

vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  aiBudgetAvailable: () => h.budgetAvailable(),
}))

vi.mock('../merge-search.service', () => ({
  findMergeCandidates: (...a: unknown[]) => h.findCandidates(...a),
}))

vi.mock('../merge-assessment.service', () => ({
  assessMergeCandidates: (...a: unknown[]) => h.assess(...a),
  determineDirection: vi.fn(() => ({ sourcePostId: '', targetPostId: '' })),
}))

vi.mock('../merge-suggestion.service', () => ({
  createMergeSuggestion: vi.fn(),
  expireStaleMergeSuggestions: () => h.expire(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: { posts: { findFirst: (...a: unknown[]) => h.postFindFirst(...a) } },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: (...a: unknown[]) => h.limit(...a) })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    })),
  },
  and: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  notInArray: vi.fn(),
}))

vi.mock('@/lib/server/domains/ai/config', () => ({ getOpenAI: vi.fn(() => ({})) }))
vi.mock('@/lib/server/domains/ai/models', () => ({ getChatModel: vi.fn(() => 'test-model') }))

// Imported fresh: resetModules gives the service its own class, and instanceof
// only holds against that one.
const refusal = async () => {
  const { TierLimitError } = await import('@/lib/server/errors/tier-limit-error')
  return new TierLimitError({
    limit: 'aiTokensPerMonth',
    current: 0,
    max: 0,
    message: 'AI features are not included on your plan. Upgrade to enable them.',
  })
}

describe('sweepMergeSuggestions with no AI budget', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      queueMicrotask(fn)
      return 0 as unknown as ReturnType<typeof global.setTimeout>
    }) as unknown as typeof global.setTimeout)
    h.budgetAvailable.mockResolvedValue(true)
    h.postFindFirst.mockResolvedValue({
      id: 'post_x',
      title: 't',
      content: 'c',
      voteCount: 0,
      commentCount: 0,
      createdAt: new Date(),
      deletedAt: null,
      canonicalPostId: null,
      embedding: [0.1],
    })
    h.findCandidates.mockResolvedValue([
      {
        postId: 'post_c',
        title: 'c',
        content: 'c',
        voteCount: 0,
        commentCount: 0,
        createdAt: new Date(),
        vectorScore: 0.9,
        ftsScore: 0.5,
        hybridScore: 0.9,
      },
    ])
  })

  it('does no work and logs no error when the budget is unavailable', async () => {
    h.budgetAvailable.mockResolvedValue(false)
    h.limit.mockResolvedValue(['post_a', 'post_b'].map((id) => ({ id: id as PostId })))
    h.assess.mockRejectedValue(await refusal())

    const { sweepMergeSuggestions } = await import('../merge-check.service')
    await sweepMergeSuggestions()

    expect(h.limit).not.toHaveBeenCalled()
    expect(h.assess).not.toHaveBeenCalled()
    expect(h.log.error).not.toHaveBeenCalled()
  })

  it('still expires stale suggestions when the budget is unavailable', async () => {
    h.budgetAvailable.mockResolvedValue(false)

    const { sweepMergeSuggestions } = await import('../merge-check.service')
    await sweepMergeSuggestions()

    expect(h.expire).toHaveBeenCalledTimes(1)
  })

  it('stops at the first TierLimitError and logs once at info', async () => {
    h.limit.mockResolvedValue(['post_a', 'post_b', 'post_c'].map((id) => ({ id: id as PostId })))
    h.assess.mockRejectedValue(await refusal())

    const { sweepMergeSuggestions } = await import('../merge-check.service')
    await sweepMergeSuggestions()

    expect(h.assess).toHaveBeenCalledTimes(1)
    expect(h.limit).toHaveBeenCalledTimes(1)
    expect(h.log.error).not.toHaveBeenCalled()
    const stops = h.log.info.mock.calls.filter(([, msg]) => /budget/.test(String(msg)))
    expect(stops).toHaveLength(1)
  })

  it('still logs other errors at error and keeps going', async () => {
    h.limit
      .mockResolvedValueOnce(['post_a', 'post_b'].map((id) => ({ id: id as PostId })))
      .mockResolvedValue([])
    h.assess.mockRejectedValue(new Error('upstream down'))

    const { sweepMergeSuggestions } = await import('../merge-check.service')
    await sweepMergeSuggestions()

    expect(h.assess).toHaveBeenCalledTimes(2)
    expect(h.log.error).toHaveBeenCalledTimes(2)
  })
})

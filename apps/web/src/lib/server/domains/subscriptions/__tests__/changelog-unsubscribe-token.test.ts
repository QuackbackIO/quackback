import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

const mockInsertValues = vi.fn()
const mockTokenFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockUnsubscribeChangelog = vi.fn()

vi.mock('@/lib/server/domains/changelog/changelog-subscription.service', () => ({
  unsubscribeChangelog: (...args: unknown[]) => mockUnsubscribeChangelog(...args),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      unsubscribeTokens: { findFirst: (...args: unknown[]) => mockTokenFindFirst(...args) },
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
      posts: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    insert: () => ({ values: (values: unknown) => mockInsertValues(values) }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        return { where: (...args: unknown[]) => mockUpdateWhere(...args) }
      },
    }),
  },
  eq: vi.fn(),
}))

const PRINCIPAL_ID = 'principal_01user' as PrincipalId

beforeEach(() => {
  vi.clearAllMocks()
  mockPrincipalFindFirst.mockResolvedValue({ id: PRINCIPAL_ID })
})

describe('generateChangelogUnsubscribeToken', () => {
  it('creates a token with action=unsubscribe_changelog and no postId', async () => {
    const { generateChangelogUnsubscribeToken } = await import('../subscription.service')

    const token = await generateChangelogUnsubscribeToken(PRINCIPAL_ID)

    expect(token).toBeTruthy()
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: PRINCIPAL_ID,
        postId: null,
        action: 'unsubscribe_changelog',
      })
    )
  })
})

describe('batchGenerateChangelogUnsubscribeTokens', () => {
  it('returns an empty map for an empty input', async () => {
    const { batchGenerateChangelogUnsubscribeTokens } = await import('../subscription.service')
    const map = await batchGenerateChangelogUnsubscribeTokens([])
    expect(map.size).toBe(0)
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('generates one token per principal', async () => {
    const { batchGenerateChangelogUnsubscribeTokens } = await import('../subscription.service')
    const ids = ['principal_01a', 'principal_01b'] as PrincipalId[]

    const map = await batchGenerateChangelogUnsubscribeTokens(ids)

    expect(map.size).toBe(2)
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ principalId: 'principal_01a', action: 'unsubscribe_changelog' }),
        expect.objectContaining({ principalId: 'principal_01b', action: 'unsubscribe_changelog' }),
      ])
    )
  })
})

describe('processUnsubscribeToken — unsubscribe_changelog', () => {
  it('calls unsubscribeChangelog for the token principal', async () => {
    mockTokenFindFirst.mockResolvedValueOnce({
      id: 'unsub_token_01x',
      token: 'tok123',
      principalId: PRINCIPAL_ID,
      postId: null,
      action: 'unsubscribe_changelog',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const { processUnsubscribeToken } = await import('../subscription.service')

    const result = await processUnsubscribeToken('tok123')

    expect(mockUnsubscribeChangelog).toHaveBeenCalledWith(PRINCIPAL_ID)
    expect(result?.action).toBe('unsubscribe_changelog')
  })

  it('returns null for an already-used token', async () => {
    mockTokenFindFirst.mockResolvedValueOnce({
      id: 'unsub_token_01x',
      token: 'tok123',
      principalId: PRINCIPAL_ID,
      postId: null,
      action: 'unsubscribe_changelog',
      usedAt: new Date('2020-01-01'),
      expiresAt: new Date(Date.now() + 60_000),
    })
    const { processUnsubscribeToken } = await import('../subscription.service')

    const result = await processUnsubscribeToken('tok123')

    expect(result).toBeNull()
    expect(mockUnsubscribeChangelog).not.toHaveBeenCalled()
  })
})

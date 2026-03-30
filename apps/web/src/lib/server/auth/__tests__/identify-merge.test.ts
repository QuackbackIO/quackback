import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId, UserId } from '@quackback/ids'

/**
 * Tests for resolveAndMergeAnonymousToken — the server-side logic that
 * validates a previousToken from the widget and merges anonymous activity
 * into the newly identified user.
 */

// Mock DB
const mockSessionFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      session: { findFirst: (...args: unknown[]) => mockSessionFindFirst(...args) },
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
    },
  },
  session: { token: 'token', expiresAt: 'expiresAt', userId: 'userId' },
  principal: { userId: 'userId', id: 'id' },
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
}))

// Mock the merge utility
const mockMerge = vi.fn()
vi.mock('../merge-anonymous', () => ({
  mergeAnonymousToIdentified: (...args: unknown[]) => mockMerge(...args),
}))

import { resolveAndMergeAnonymousToken } from '../identify-merge'

describe('resolveAndMergeAnonymousToken', () => {
  const TARGET_PRINCIPAL_ID = 'principal_target' as PrincipalId

  beforeEach(() => {
    vi.clearAllMocks()
    mockMerge.mockResolvedValue(undefined)
  })

  it('does nothing when previousToken is null/undefined', async () => {
    await resolveAndMergeAnonymousToken({
      previousToken: null,
      targetPrincipalId: TARGET_PRINCIPAL_ID,
      targetDisplayName: 'Jane',
    })

    expect(mockSessionFindFirst).not.toHaveBeenCalled()
    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('does nothing when previousToken is empty string', async () => {
    await resolveAndMergeAnonymousToken({
      previousToken: '',
      targetPrincipalId: TARGET_PRINCIPAL_ID,
      targetDisplayName: 'Jane',
    })

    expect(mockSessionFindFirst).not.toHaveBeenCalled()
    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('does nothing when session is not found (expired or invalid token)', async () => {
    mockSessionFindFirst.mockResolvedValue(null)

    await resolveAndMergeAnonymousToken({
      previousToken: 'expired-token',
      targetPrincipalId: TARGET_PRINCIPAL_ID,
      targetDisplayName: 'Jane',
    })

    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('does nothing when principal is not found for the session user', async () => {
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_anon',
      user: { id: 'user_anon', name: 'Anon' },
    })
    mockPrincipalFindFirst.mockResolvedValue(null)

    await resolveAndMergeAnonymousToken({
      previousToken: 'valid-token',
      targetPrincipalId: TARGET_PRINCIPAL_ID,
      targetDisplayName: 'Jane',
    })

    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('does nothing when previous session belongs to a non-anonymous user', async () => {
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_real',
      user: { id: 'user_real', name: 'Real User' },
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_real',
      type: 'user', // NOT anonymous
      displayName: 'Real User',
    })

    await resolveAndMergeAnonymousToken({
      previousToken: 'real-user-token',
      targetPrincipalId: TARGET_PRINCIPAL_ID,
      targetDisplayName: 'Jane',
    })

    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('does nothing when previous anonymous principal is the same as target', async () => {
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_same',
      user: { id: 'user_same', name: 'Same User' },
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: TARGET_PRINCIPAL_ID, // same as target
      type: 'anonymous',
      displayName: 'Curious Penguin',
    })

    await resolveAndMergeAnonymousToken({
      previousToken: 'same-user-token',
      targetPrincipalId: TARGET_PRINCIPAL_ID,
      targetDisplayName: 'Jane',
    })

    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('calls merge when previous session is a different anonymous user', async () => {
    const anonPrincipalId = 'principal_anon' as PrincipalId
    const anonUserId = 'user_anon' as UserId

    mockSessionFindFirst.mockResolvedValue({
      userId: anonUserId,
      user: { id: anonUserId, name: 'Anon User' },
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: anonPrincipalId,
      type: 'anonymous',
      displayName: 'Curious Penguin',
    })

    await resolveAndMergeAnonymousToken({
      previousToken: 'anon-token-123',
      targetPrincipalId: TARGET_PRINCIPAL_ID,
      targetDisplayName: 'Jane Doe',
    })

    expect(mockMerge).toHaveBeenCalledWith({
      anonPrincipalId,
      targetPrincipalId: TARGET_PRINCIPAL_ID,
      anonUserId,
      anonDisplayName: 'Curious Penguin',
      targetDisplayName: 'Jane Doe',
    })
  })

  it('does not throw when merge fails (graceful degradation)', async () => {
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_anon',
      user: { id: 'user_anon', name: 'Anon' },
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_anon',
      type: 'anonymous',
      displayName: 'Anon',
    })
    mockMerge.mockRejectedValue(new Error('DB constraint violation'))

    // Should not throw — merge failures are non-fatal
    await expect(
      resolveAndMergeAnonymousToken({
        previousToken: 'anon-token',
        targetPrincipalId: TARGET_PRINCIPAL_ID,
        targetDisplayName: 'Jane',
      })
    ).resolves.toBeUndefined()
  })
})

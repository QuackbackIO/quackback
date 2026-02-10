import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock getRequestHeaders before importing the module under test
const mockGet = vi.fn()
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => ({ get: mockGet }),
}))

// Mock db
const mockSessionFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockInsert = vi.fn()
const mockReturning = vi.fn()
const mockValues = vi.fn(() => ({ returning: mockReturning }))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      session: { findFirst: (...args: unknown[]) => mockSessionFindFirst(...args) },
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
    },
    insert: (...args: unknown[]) => {
      mockInsert(...args)
      return { values: mockValues }
    },
  },
  session: { token: 'token', expiresAt: 'expiresAt', userId: 'userId' },
  principal: { userId: 'userId' },
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
}))

vi.mock('@quackback/ids', () => ({
  generateId: vi.fn(() => 'principal_mock123'),
}))

// Mock workspace settings
vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: vi.fn(() => ({
    id: 'ws_123',
    slug: 'acme',
    name: 'Acme Inc',
  })),
}))

import { getWidgetSession } from '../widget-auth'

describe('getWidgetSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when no Authorization header', async () => {
    mockGet.mockReturnValue(null)

    const result = await getWidgetSession()
    expect(result).toBeNull()
  })

  it('should return null when Authorization header is not Bearer', async () => {
    mockGet.mockReturnValue('Basic abc123')

    const result = await getWidgetSession()
    expect(result).toBeNull()
  })

  it('should return null when token is empty after Bearer', async () => {
    mockGet.mockReturnValue('Bearer ')

    const result = await getWidgetSession()
    expect(result).toBeNull()
  })

  it('should return null when session not found', async () => {
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue(null)

    const result = await getWidgetSession()
    expect(result).toBeNull()
  })

  it('should return null when session has no user', async () => {
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue({ userId: 'user_1', user: null })

    const result = await getWidgetSession()
    expect(result).toBeNull()
  })

  it('should return auth context for valid session with existing principal', async () => {
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_1',
      user: { id: 'user_1', email: 'jane@acme.com', name: 'Jane', image: 'https://avatar.url' },
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_1',
      role: 'user',
    })

    const result = await getWidgetSession()

    expect(result).toEqual({
      settings: { id: 'ws_123', slug: 'acme', name: 'Acme Inc' },
      user: { id: 'user_1', email: 'jane@acme.com', name: 'Jane', image: 'https://avatar.url' },
      principal: { id: 'principal_1', role: 'user' },
    })
  })

  it('should auto-create principal when none exists', async () => {
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_1',
      user: { id: 'user_1', email: 'jane@acme.com', name: 'Jane', image: null },
    })
    mockPrincipalFindFirst.mockResolvedValue(null)
    mockReturning.mockResolvedValue([{ id: 'principal_mock123', role: 'user' }])

    const result = await getWidgetSession()

    expect(mockInsert).toHaveBeenCalled()
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'principal_mock123',
        userId: 'user_1',
        role: 'user',
        displayName: 'Jane',
        avatarUrl: null,
      })
    )
    expect(result).toEqual({
      settings: { id: 'ws_123', slug: 'acme', name: 'Acme Inc' },
      user: { id: 'user_1', email: 'jane@acme.com', name: 'Jane', image: null },
      principal: { id: 'principal_mock123', role: 'user' },
    })
  })

  it('should handle null image gracefully', async () => {
    mockGet.mockReturnValue('Bearer valid-token-123')
    mockSessionFindFirst.mockResolvedValue({
      userId: 'user_1',
      user: { id: 'user_1', email: 'test@test.com', name: 'Test', image: null },
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_1',
      role: 'member',
    })

    const result = await getWidgetSession()

    expect(result?.user.image).toBeNull()
    expect(result?.principal.role).toBe('member')
  })
})

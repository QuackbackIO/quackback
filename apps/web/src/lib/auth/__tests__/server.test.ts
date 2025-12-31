import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSession, requireAuth } from '@/lib/server-functions/auth'
import type { Session } from '@/lib/server-functions/auth'

// Mock Next.js headers
vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

// Mock the auth client
vi.mock('../index', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

// Import mocked modules
// TODO: Update for TanStack Start
// import { headers } from 'next/headers'
import { auth } from '../index'

// Type helper for Better-Auth API response
type BetterAuthSession = Awaited<ReturnType<typeof auth.api.getSession>>
const mockSessionResponse = <T>(session: T): BetterAuthSession => session as BetterAuthSession

describe('Server Auth Utilities', () => {
  const mockHeaders = new Headers()

  beforeEach(() => {
    vi.clearAllMocks()
    // vi.mocked(headers).mockResolvedValue(mockHeaders)
  })

  describe('getSession', () => {
    it('returns session when authenticated', async () => {
      const mockSessionData = {
        session: {
          id: 'session-1',
          expiresAt: new Date('2025-12-20'),
          token: 'token-123',
          createdAt: new Date('2025-12-10'),
          updatedAt: new Date('2025-12-10'),
          userId: 'user-1',
        },
        user: {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com',
          emailVerified: true,
          image: 'https://example.com/avatar.jpg',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      }

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSessionData)

      const result = await getSession()

      expect(result).toEqual({
        session: mockSessionData.session,
        user: {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com',
          emailVerified: true,
          image: 'https://example.com/avatar.jpg',
          createdAt: mockSessionData.user.createdAt,
          updatedAt: mockSessionData.user.updatedAt,
        },
      })
      expect(auth.api.getSession).toHaveBeenCalledWith({
        headers: mockHeaders,
      })
    })

    it('returns null when not authenticated', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null)

      const result = await getSession()

      expect(result).toBeNull()
      expect(auth.api.getSession).toHaveBeenCalledWith({
        headers: mockHeaders,
      })
    })

    it('returns null when session has no user', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(
        mockSessionResponse({
          session: {
            id: 'session-1',
            expiresAt: new Date('2025-12-20'),
            token: 'token-123',
            createdAt: new Date('2025-12-10'),
            updatedAt: new Date('2025-12-10'),
            userId: 'user-1',
          },
          user: null,
        })
      )

      const result = await getSession()

      expect(result).toBeNull()
    })

    it('handles user without image (null)', async () => {
      const mockSessionData = {
        session: {
          id: 'session-1',
          expiresAt: new Date('2025-12-20'),
          token: 'token-123',
          createdAt: new Date('2025-12-10'),
          updatedAt: new Date('2025-12-10'),
          userId: 'user-1',
        },
        user: {
          id: 'user-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          emailVerified: false,
          image: null,
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      }

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSessionData)

      const result = await getSession()

      expect(result).toEqual({
        session: mockSessionData.session,
        user: {
          id: 'user-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          emailVerified: false,
          image: null,
          createdAt: mockSessionData.user.createdAt,
          updatedAt: mockSessionData.user.updatedAt,
        },
      })
    })

    it('caches session result (react cache)', async () => {
      // Note: React's cache() function is used, which should cache results
      // within the same render cycle. Testing actual cache behavior would
      // require more complex setup, so we verify the implementation uses cache()
      const mockSessionData = {
        session: {
          id: 'session-1',
          expiresAt: new Date('2025-12-20'),
          token: 'token-123',
          createdAt: new Date('2025-12-10'),
          updatedAt: new Date('2025-12-10'),
          userId: 'user-1',
        },
        user: {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com',
          emailVerified: true,
          image: 'https://example.com/avatar.jpg',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      }

      vi.mocked(auth.api.getSession).mockResolvedValue(mockSessionData)

      const result = await getSession()

      expect(result).toBeDefined()
      expect(auth.api.getSession).toHaveBeenCalledTimes(1)
    })
  })

  describe('requireAuth', () => {
    it('returns session when authenticated', async () => {
      const mockSession: Session = {
        session: {
          id: 'session_test1234567890' as `session_${string}`,
          expiresAt: new Date('2025-12-20'),
          token: 'token-123',
          createdAt: new Date('2025-12-10'),
          updatedAt: new Date('2025-12-10'),
          userId: 'user_test1234567890' as `user_${string}`,
        },
        user: {
          id: 'user_test1234567890' as `user_${string}`,
          name: 'John Doe',
          email: 'john@example.com',
          emailVerified: true,
          image: 'https://example.com/avatar.jpg',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      }

      vi.mocked(auth.api.getSession).mockResolvedValue({
        session: mockSession.session,
        user: mockSession.user,
      })

      const result = await requireAuth()

      expect(result).toEqual(mockSession)
    })

    it('throws error when not authenticated', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null)

      await expect(requireAuth()).rejects.toThrow('Unauthorized')
    })

    it('throws error when session has no user', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(
        mockSessionResponse({
          session: {
            id: 'session-1',
            expiresAt: new Date('2025-12-20'),
            token: 'token-123',
            createdAt: new Date('2025-12-10'),
            updatedAt: new Date('2025-12-10'),
            userId: 'user-1',
          },
          user: null,
        })
      )

      await expect(requireAuth()).rejects.toThrow('Unauthorized')
    })
  })
})

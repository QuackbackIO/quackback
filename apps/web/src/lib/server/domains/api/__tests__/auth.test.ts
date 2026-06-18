import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireApiKey, withApiKeyAuth, type AuthLevel } from '../auth'
import type { ApiKey } from '@/lib/server/domains/api-keys'
import type { PrincipalId, ApiKeyId } from '@quackback/ids'
import { UnauthorizedError, ForbiddenError } from '@/lib/shared/errors'

// Mock the verifyApiKey function
vi.mock('@/lib/server/domains/api-keys/api-key.service', () => ({
  verifyApiKey: vi.fn(),
}))

// Mock the database — use vi.hoisted() so mockFindFirst is available when vi.mock factory runs
const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn().mockResolvedValue({ role: 'admin' }),
}))
vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: {
        findFirst: mockFindFirst,
      },
    },
    select: () => ({ from: () => ({ limit: () => Promise.resolve([]) }) }),
  },
  principal: { id: 'id' },
  settings: { tierLimits: 'tier_limits' },
  eq: vi.fn(),
}))

describe('API Auth', () => {
  const mockApiKey: ApiKey = {
    id: 'apikey_01h455vb4pex5vsknk084sn02q' as ApiKeyId,
    name: 'Test Key',
    keyPrefix: 'qb_test',
    principalId: 'principal_01h455vb4pex5vsknk084sn02s' as PrincipalId,
    createdById: 'member_01h455vb4pex5vsknk084sn02r' as PrincipalId,
    createdAt: new Date(),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('requireApiKey', () => {
    it('should return null when no Authorization header', async () => {
      const request = new Request('https://example.com/api', {
        method: 'GET',
      })

      const result = await requireApiKey(request)
      expect(result).toBeNull()
    })

    it('should return null when Authorization header is not Bearer', async () => {
      const request = new Request('https://example.com/api', {
        method: 'GET',
        headers: {
          Authorization: 'Basic abc123',
        },
      })

      const result = await requireApiKey(request)
      expect(result).toBeNull()
    })

    it('should return null when API key is invalid', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(null)

      const request = new Request('https://example.com/api', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer qb_invalid_key',
        },
      })

      const result = await requireApiKey(request)
      expect(result).toBeNull()
    })

    it('should return auth context when API key is valid', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(mockApiKey)

      const request = new Request('https://example.com/api', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer qb_valid_key',
        },
      })

      const result = await requireApiKey(request)
      expect(result).toEqual({
        apiKey: mockApiKey,
        principalId: mockApiKey.principalId,
        role: 'admin',
        importMode: false,
      })
    })

    it('should handle Bearer token with extra whitespace', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(mockApiKey)

      const request = new Request('https://example.com/api', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer   qb_valid_key',
        },
      })

      const result = await requireApiKey(request)
      expect(result).not.toBeNull()
    })

    it('should handle case-insensitive Bearer prefix', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(mockApiKey)

      const request = new Request('https://example.com/api', {
        method: 'GET',
        headers: {
          Authorization: 'BEARER qb_valid_key',
        },
      })

      const result = await requireApiKey(request)
      expect(result).not.toBeNull()
    })
  })

  describe('withApiKeyAuth', () => {
    it('should throw UnauthorizedError when authentication fails', async () => {
      const request = new Request('https://example.com/api', {
        method: 'GET',
      })

      await expect(withApiKeyAuth(request, { role: 'team' })).rejects.toThrow(UnauthorizedError)
    })

    it('should include hint about Bearer format in error message', async () => {
      const request = new Request('https://example.com/api', {
        method: 'GET',
      })

      await expect(withApiKeyAuth(request, { role: 'team' })).rejects.toThrow('Bearer qb_xxx')
    })

    it('should return auth context when authentication succeeds with team role', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(mockApiKey)

      const request = new Request('https://example.com/api', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer qb_valid_key',
        },
      })

      const result = await withApiKeyAuth(request, { role: 'team' })

      expect(result).toEqual({
        apiKey: mockApiKey,
        principalId: mockApiKey.principalId,
        role: 'admin',
        importMode: false,
      })
    })

    it('should throw ForbiddenError when admin role required but member is not admin', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(mockApiKey)

      mockFindFirst.mockResolvedValue({ role: 'member' })

      const request = new Request('https://example.com/api', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer qb_valid_key',
        },
      })

      await expect(withApiKeyAuth(request, { role: 'admin' })).rejects.toThrow(ForbiddenError)
      await expect(withApiKeyAuth(request, { role: 'admin' })).rejects.toThrow(
        'Admin access required'
      )
    })

    it('should throw ForbiddenError when team role required but member is a portal user', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(mockApiKey)

      mockFindFirst.mockResolvedValue({ role: 'user' })

      const request = new Request('https://example.com/api', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer qb_valid_key',
        },
      })

      await expect(withApiKeyAuth(request, { role: 'team' })).rejects.toThrow(ForbiddenError)
      await expect(withApiKeyAuth(request, { role: 'team' })).rejects.toThrow(
        'Team member access required'
      )
    })

    it('should allow admin through for both team and admin roles', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(mockApiKey)

      mockFindFirst.mockResolvedValue({ role: 'admin' })

      const request = new Request('https://example.com/api', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer qb_valid_key',
        },
      })

      for (const role of ['team', 'admin'] as AuthLevel[]) {
        const result = await withApiKeyAuth(request, { role })
        expect(result).toBeDefined()
        expect(result.role).toBe('admin')
      }
    })
  })
})

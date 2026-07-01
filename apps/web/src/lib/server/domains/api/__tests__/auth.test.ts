import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireApiKey, withApiKeyAuth } from '../auth'
import type { ApiKey } from '@/lib/server/domains/api-keys'
import type { PrincipalId, ApiKeyId } from '@quackback/ids'
import { UnauthorizedError, ForbiddenError } from '@/lib/shared/errors'
import { PERMISSIONS } from '@/lib/shared/permissions'

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
    const bearer = () =>
      new Request('https://example.com/api', {
        method: 'GET',
        headers: { Authorization: 'Bearer qb_valid_key' },
      })

    it('should throw UnauthorizedError when authentication fails', async () => {
      const request = new Request('https://example.com/api', { method: 'GET' })
      await expect(
        withApiKeyAuth(request, { permission: PERMISSIONS.POST_VIEW_PRIVATE })
      ).rejects.toThrow(UnauthorizedError)
    })

    it('should include hint about Bearer format in error message', async () => {
      const request = new Request('https://example.com/api', { method: 'GET' })
      await expect(
        withApiKeyAuth(request, { permission: PERMISSIONS.POST_VIEW_PRIVATE })
      ).rejects.toThrow('Bearer qb_xxx')
    })

    it('returns the auth context when the key owner holds the permission', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(mockApiKey)
      mockFindFirst.mockResolvedValue({ role: 'admin' })

      const result = await withApiKeyAuth(bearer(), { permission: PERMISSIONS.POST_VIEW_PRIVATE })

      expect(result).toEqual({
        apiKey: mockApiKey,
        principalId: mockApiKey.principalId,
        role: 'admin',
        importMode: false,
      })
    })

    it('throws ForbiddenError when the owner (member) lacks a workspace-admin permission', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(mockApiKey)
      mockFindFirst.mockResolvedValue({ role: 'member' })

      await expect(
        withApiKeyAuth(bearer(), { permission: PERMISSIONS.BILLING_MANAGE })
      ).rejects.toThrow(ForbiddenError)
      await expect(
        withApiKeyAuth(bearer(), { permission: PERMISSIONS.BILLING_MANAGE })
      ).rejects.toThrow("Requires the 'billing.manage' permission")
    })

    it('throws ForbiddenError when the owner is a portal user (no team permissions)', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(mockApiKey)
      mockFindFirst.mockResolvedValue({ role: 'user' })

      await expect(
        withApiKeyAuth(bearer(), { permission: PERMISSIONS.POST_VIEW_PRIVATE })
      ).rejects.toThrow(ForbiddenError)
    })

    it('allows a valid key with no permission gate (public read)', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(mockApiKey)
      mockFindFirst.mockResolvedValue({ role: 'user' })

      const result = await withApiKeyAuth(bearer())
      expect(result.principalId).toBe(mockApiKey.principalId)
    })
  })
})

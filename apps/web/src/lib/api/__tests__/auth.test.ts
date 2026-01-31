import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireApiKey, withApiKeyAuth } from '../auth'
import type { ApiKey } from '@/lib/api-keys'
import type { MemberId, ApiKeyId } from '@quackback/ids'

// Mock the verifyApiKey function
vi.mock('@/lib/api-keys', () => ({
  verifyApiKey: vi.fn(),
}))

describe('API Auth', () => {
  const mockApiKey: ApiKey = {
    id: 'apikey_123' as ApiKeyId,
    name: 'Test Key',
    keyPrefix: 'qb_test',
    createdById: 'member_456' as MemberId,
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
      const { verifyApiKey } = await import('@/lib/api-keys')
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
      const { verifyApiKey } = await import('@/lib/api-keys')
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
        memberId: mockApiKey.createdById,
      })
    })

    it('should handle Bearer token with extra whitespace', async () => {
      const { verifyApiKey } = await import('@/lib/api-keys')
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
      const { verifyApiKey } = await import('@/lib/api-keys')
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
    it('should return 401 response when authentication fails', async () => {
      const request = new Request('https://example.com/api', {
        method: 'GET',
      })

      const result = await withApiKeyAuth(request)

      expect(result instanceof Response).toBe(true)
      const response = result as Response
      expect(response.status).toBe(401)

      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('UNAUTHORIZED')
      expect(body.error.message).toContain('Invalid or missing API key')
    })

    it('should return auth context when authentication succeeds', async () => {
      const { verifyApiKey } = await import('@/lib/api-keys')
      vi.mocked(verifyApiKey).mockResolvedValue(mockApiKey)

      const request = new Request('https://example.com/api', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer qb_valid_key',
        },
      })

      const result = await withApiKeyAuth(request)

      expect(result instanceof Response).toBe(false)
      expect(result).toEqual({
        apiKey: mockApiKey,
        memberId: mockApiKey.createdById,
      })
    })

    it('should include hint about Bearer format in error message', async () => {
      const request = new Request('https://example.com/api', {
        method: 'GET',
      })

      const result = await withApiKeyAuth(request)
      const response = result as Response
      const body = (await response.json()) as { error: { code: string; message: string } }

      expect(body.error.message).toContain('Bearer qb_xxx')
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireApiKey, withApiKeyAuth, assertApiPermissions } from '../auth'
import type { ApiKey, ApiKeyScope } from '@/lib/server/domains/api-keys'
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
vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      principal: {
        findFirst: mockFindFirst,
      },
    },
    select: () => ({ from: () => ({ limit: () => Promise.resolve([]) }) }),
  },
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
    scopes: null,
  }

  const scopedKey = (scopes: ApiKeyScope[]): ApiKey => ({ ...mockApiKey, scopes })

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
        // The principal row from the single auth query rides along for reuse
        principal: { role: 'admin' },
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
        principal: { role: 'admin' },
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

  describe('key scope enforcement (owner permissions ∩ key scopes)', () => {
    const asAdminOwner = async (key: ApiKey) => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(key)
      mockFindFirst.mockResolvedValue({ role: 'admin' })
    }
    const bearer = () =>
      new Request('https://example.com/api', {
        method: 'GET',
        headers: { Authorization: 'Bearer qb_valid_key' },
      })

    it('a scoped key passes a permission gate whose mapped scope it holds', async () => {
      await asAdminOwner(scopedKey(['read:feedback']))
      const result = await withApiKeyAuth(bearer(), { permission: PERMISSIONS.POST_VIEW_PRIVATE })
      expect(result.role).toBe('admin')
    })

    it('a scoped key is denied a permission gate whose mapped scope it lacks', async () => {
      await asAdminOwner(scopedKey(['read:feedback']))
      await expect(
        withApiKeyAuth(bearer(), { permission: PERMISSIONS.POST_CREATE })
      ).rejects.toThrow(ForbiddenError)
      await asAdminOwner(scopedKey(['read:feedback']))
      await expect(
        withApiKeyAuth(bearer(), { permission: PERMISSIONS.POST_CREATE })
      ).rejects.toThrow("'write:feedback' scope")
    })

    it('a scoped key is denied cross-domain permissions (chat scope for conversation.view)', async () => {
      await asAdminOwner(scopedKey(['read:feedback', 'write:feedback']))
      await expect(
        withApiKeyAuth(bearer(), { permission: PERMISSIONS.CONVERSATION_VIEW })
      ).rejects.toThrow("'read:chat' scope")
    })

    it('a null-scope (legacy) key keeps full owner authority', async () => {
      await asAdminOwner(mockApiKey)
      const result = await withApiKeyAuth(bearer(), { permission: PERMISSIONS.POST_CREATE })
      expect(result.role).toBe('admin')
    })

    it('the owner permission check still applies before the scope check', async () => {
      // A member-owned key with every scope still cannot pass an admin-only gate.
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(scopedKey(['read:feedback', 'write:feedback']))
      mockFindFirst.mockResolvedValue({ role: 'member' })
      await expect(
        withApiKeyAuth(bearer(), { permission: PERMISSIONS.BILLING_MANAGE })
      ).rejects.toThrow("'billing.manage' permission")
    })

    it('assertApiPermissions enforces the mapped scope per permission for scoped keys', async () => {
      await asAdminOwner(scopedKey(['write:feedback', 'read:feedback']))
      const auth = await withApiKeyAuth(bearer())

      expect(() =>
        assertApiPermissions(auth, [PERMISSIONS.POST_EDIT, PERMISSIONS.POST_SET_STATUS])
      ).not.toThrow()
      expect(() => assertApiPermissions(auth, [PERMISSIONS.CHANGELOG_MANAGE])).toThrow(
        "'write:changelog' scope"
      )
    })

    it('assertApiPermissions stays owner-permission-only for legacy keys', async () => {
      await asAdminOwner(mockApiKey)
      const auth = await withApiKeyAuth(bearer())
      expect(() => assertApiPermissions(auth, [PERMISSIONS.CHANGELOG_MANAGE])).not.toThrow()
    })

    it('an internal-only key (no vocabulary scopes) has no general-API authority', async () => {
      await asAdminOwner(scopedKey([]))
      await expect(
        withApiKeyAuth(bearer(), { permission: PERMISSIONS.POST_VIEW_PRIVATE })
      ).rejects.toThrow(ForbiddenError)
    })
  })
})

/**
 * Tests for tenant resolver
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolveTenantFromDomain, clearTenantCache, clearAllTenantCache } from '../resolver'

// Hoist mocks so they're available before module imports
const { mockGetTenantDb, mockFetch } = vi.hoisted(() => ({
  mockGetTenantDb: vi.fn((workspaceId: string, connectionString: string) => ({
    _workspaceId: workspaceId,
    _connectionString: connectionString,
    query: {},
  })),
  mockFetch: vi.fn(),
}))

// Mock db-cache
vi.mock('../db-cache', () => ({
  getTenantDb: mockGetTenantDb,
}))

// Store original env and fetch
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

// Helper to create request with explicit host header (Node.js doesn't auto-set it)
function createRequest(url: string): Request {
  const urlObj = new URL(url)
  return new Request(url, {
    headers: {
      host: urlObj.host,
    },
  })
}

describe('resolver', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockGetTenantDb.mockClear()
    // Stub fetch globally
    globalThis.fetch = mockFetch
    // Clear tenant cache between tests
    clearAllTenantCache()
    // Reset environment
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    globalThis.fetch = originalFetch
  })

  describe('resolveTenantFromDomain', () => {
    it('should return null when TENANT_API_URL not configured', async () => {
      delete process.env.TENANT_API_URL
      delete process.env.TENANT_API_SECRET

      const request = createRequest('https://acme.example.com/dashboard')
      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should return null when TENANT_API_SECRET not configured', async () => {
      process.env.TENANT_API_URL = 'https://website.example.com'
      delete process.env.TENANT_API_SECRET

      const request = createRequest('https://acme.example.com/dashboard')
      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should return null when host header is missing', async () => {
      process.env.TENANT_API_URL = 'https://website.example.com'
      process.env.TENANT_API_SECRET = 'secret123'

      // Create request without host header
      const request = new Request('https://example.com/dashboard')
      // Request constructor doesn't set host in Node.js, so this is already null

      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should call API and return tenant context on success', async () => {
      process.env.TENANT_API_URL = 'https://website.example.com'
      process.env.TENANT_API_SECRET = 'secret123'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspaceId: 'workspace_abc',
          slug: 'acme',
          connectionString: 'postgres://tenant/db',
        }),
      })

      const request = createRequest('https://acme.quackback.io/dashboard')
      const result = await resolveTenantFromDomain(request)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://website.example.com/api/internal/resolve-domain?domain=acme.quackback.io',
        {
          headers: {
            Authorization: 'Bearer secret123',
          },
        }
      )
      expect(result).toEqual({
        workspaceId: 'workspace_abc',
        slug: 'acme',
        db: expect.objectContaining({
          _workspaceId: 'workspace_abc',
          _connectionString: 'postgres://tenant/db',
        }),
      })
    })

    it('should cache successful responses', async () => {
      process.env.TENANT_API_URL = 'https://website.example.com'
      process.env.TENANT_API_SECRET = 'secret123'

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          workspaceId: 'workspace_abc',
          slug: 'acme',
          connectionString: 'postgres://tenant/db',
        }),
      })

      const request = createRequest('https://acme.quackback.io/dashboard')

      // First call
      await resolveTenantFromDomain(request)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Second call - should use cache
      await resolveTenantFromDomain(request)
      expect(mockFetch).toHaveBeenCalledTimes(1) // No additional call
    })

    it('should return null and cache 404 responses (negative caching)', async () => {
      process.env.TENANT_API_URL = 'https://website.example.com'
      process.env.TENANT_API_SECRET = 'secret123'

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const request = createRequest('https://unknown.quackback.io/dashboard')

      // First call
      const result1 = await resolveTenantFromDomain(request)
      expect(result1).toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Second call - should use negative cache
      const result2 = await resolveTenantFromDomain(request)
      expect(result2).toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(1) // No additional call
    })

    it('should return null but NOT cache 503 responses', async () => {
      process.env.TENANT_API_URL = 'https://website.example.com'
      process.env.TENANT_API_SECRET = 'secret123'

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      })

      const request = createRequest('https://migrating.quackback.io/dashboard')

      // First call
      const result1 = await resolveTenantFromDomain(request)
      expect(result1).toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Second call - should NOT use cache (503 not cached)
      await resolveTenantFromDomain(request)
      expect(mockFetch).toHaveBeenCalledTimes(2) // Made another call
    })

    it('should return null on network error', async () => {
      process.env.TENANT_API_URL = 'https://website.example.com'
      process.env.TENANT_API_SECRET = 'secret123'

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const request = createRequest('https://acme.quackback.io/dashboard')
      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
    })

    it('should strip port from host header', async () => {
      process.env.TENANT_API_URL = 'https://website.example.com'
      process.env.TENANT_API_SECRET = 'secret123'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspaceId: 'workspace_abc',
          slug: 'acme',
          connectionString: 'postgres://tenant/db',
        }),
      })

      // Create request with port in host header
      const request = new Request('https://acme.quackback.io:3000/dashboard', {
        headers: {
          host: 'acme.quackback.io:3000',
        },
      })
      await resolveTenantFromDomain(request)

      // Should call API with domain without port
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('domain=acme.quackback.io'),
        expect.anything()
      )
      // Should NOT include port
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('domain=acme.quackback.io%3A3000'),
        expect.anything()
      )
    })
  })

  describe('clearTenantCache', () => {
    it('should clear cache for specific domain', async () => {
      process.env.TENANT_API_URL = 'https://website.example.com'
      process.env.TENANT_API_SECRET = 'secret123'

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          workspaceId: 'workspace_abc',
          slug: 'acme',
          connectionString: 'postgres://tenant/db',
        }),
      })

      const request = createRequest('https://acme.quackback.io/dashboard')

      // Populate cache
      await resolveTenantFromDomain(request)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Clear cache
      clearTenantCache('acme.quackback.io')

      // Should make new API call
      await resolveTenantFromDomain(request)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('clearAllTenantCache', () => {
    it('should clear all cached domains', async () => {
      process.env.TENANT_API_URL = 'https://website.example.com'
      process.env.TENANT_API_SECRET = 'secret123'

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          workspaceId: 'workspace_abc',
          slug: 'acme',
          connectionString: 'postgres://tenant/db',
        }),
      })

      // Populate cache for multiple domains
      await resolveTenantFromDomain(createRequest('https://acme.quackback.io/'))
      await resolveTenantFromDomain(createRequest('https://beta.quackback.io/'))
      expect(mockFetch).toHaveBeenCalledTimes(2)

      // Clear all
      clearAllTenantCache()

      // Both should make new API calls
      await resolveTenantFromDomain(createRequest('https://acme.quackback.io/'))
      await resolveTenantFromDomain(createRequest('https://beta.quackback.io/'))
      expect(mockFetch).toHaveBeenCalledTimes(4)
    })
  })
})

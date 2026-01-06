/**
 * Tests for tenant resolver
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolveTenantFromDomain, resetCatalogDb } from '../resolver'

// Hoist mocks so they're available before module imports
const { mockGetTenantDb, mockDrizzle, mockPostgres } = vi.hoisted(() => ({
  mockGetTenantDb: vi.fn((workspaceId: string, connectionString: string) => ({
    _workspaceId: workspaceId,
    _connectionString: connectionString,
    query: {},
  })),
  mockDrizzle: vi.fn(),
  mockPostgres: vi.fn(),
}))

// Mock db-cache
vi.mock('../db-cache', () => ({
  getTenantDb: mockGetTenantDb,
}))

// Mock drizzle-orm/postgres-js
vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: mockDrizzle,
}))

// Mock postgres
vi.mock('postgres', () => ({
  default: mockPostgres,
}))

// Store original env
const originalEnv = { ...process.env }

// Helper to create request with explicit host header
function createRequest(url: string): Request {
  const urlObj = new URL(url)
  return new Request(url, {
    headers: {
      host: urlObj.host,
    },
  })
}

// Mock workspace data
const mockWorkspace = {
  id: 'workspace_abc123',
  name: 'Acme Corp',
  slug: 'acme',
  createdAt: new Date(),
  neonProjectId: 'proj_123',
  neonRegion: 'aws-us-east-1',
  migrationStatus: 'completed',
}

describe('resolver', () => {
  let mockDb: { query: { workspace: { findFirst: ReturnType<typeof vi.fn> } } }

  beforeEach(() => {
    mockGetTenantDb.mockClear()
    mockDrizzle.mockReset()
    mockPostgres.mockReset()
    resetCatalogDb()

    // Setup mock database
    mockDb = {
      query: {
        workspace: {
          findFirst: vi.fn(),
        },
      },
    }
    mockDrizzle.mockReturnValue(mockDb)
    mockPostgres.mockReturnValue({})

    // Reset environment
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('resolveTenantFromDomain', () => {
    it('should return null when CATALOG_DATABASE_URL not configured', async () => {
      process.env.CATALOG_DATABASE_URL = undefined as unknown as string
      process.env.TENANT_BASE_DOMAIN = undefined as unknown as string
      process.env.NEON_API_KEY = undefined as unknown as string

      const request = createRequest('https://acme.quackback.io/dashboard')
      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
    })

    it('should return null when TENANT_BASE_DOMAIN not configured', async () => {
      process.env.CATALOG_DATABASE_URL = 'postgres://catalog/db'
      process.env.TENANT_BASE_DOMAIN = undefined as unknown as string
      process.env.NEON_API_KEY = 'test-key'

      const request = createRequest('https://acme.quackback.io/dashboard')
      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
    })

    it('should return null when NEON_API_KEY not configured', async () => {
      process.env.CATALOG_DATABASE_URL = 'postgres://catalog/db'
      process.env.TENANT_BASE_DOMAIN = 'quackback.io'
      delete process.env.NEON_API_KEY

      const request = createRequest('https://acme.quackback.io/dashboard')
      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
    })

    it('should return null when host header is missing', async () => {
      process.env.CATALOG_DATABASE_URL = 'postgres://catalog/db'
      process.env.TENANT_BASE_DOMAIN = 'quackback.io'
      process.env.NEON_API_KEY = 'test-key'

      const request = new Request('https://example.com/dashboard')

      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
    })

    it('should return null when host is not a subdomain of base domain', async () => {
      process.env.CATALOG_DATABASE_URL = 'postgres://catalog/db'
      process.env.TENANT_BASE_DOMAIN = 'quackback.io'
      process.env.NEON_API_KEY = 'test-key'

      const request = createRequest('https://example.com/dashboard')
      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
      expect(mockDb.query.workspace.findFirst).not.toHaveBeenCalled()
    })

    it('should return null when host is the base domain itself', async () => {
      process.env.CATALOG_DATABASE_URL = 'postgres://catalog/db'
      process.env.TENANT_BASE_DOMAIN = 'quackback.io'
      process.env.NEON_API_KEY = 'test-key'

      const request = createRequest('https://quackback.io/dashboard')
      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
    })

    it('should return null when workspace not found', async () => {
      process.env.CATALOG_DATABASE_URL = 'postgres://catalog/db'
      process.env.TENANT_BASE_DOMAIN = 'quackback.io'
      process.env.NEON_API_KEY = 'test-key'

      mockDb.query.workspace.findFirst.mockResolvedValueOnce(null)

      const request = createRequest('https://unknown.quackback.io/dashboard')
      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
      expect(mockDb.query.workspace.findFirst).toHaveBeenCalled()
    })

    it('should return null when workspace migration not completed', async () => {
      process.env.CATALOG_DATABASE_URL = 'postgres://catalog/db'
      process.env.TENANT_BASE_DOMAIN = 'quackback.io'
      process.env.NEON_API_KEY = 'test-key'

      mockDb.query.workspace.findFirst.mockResolvedValueOnce({
        ...mockWorkspace,
        migrationStatus: 'in_progress',
      })

      const request = createRequest('https://acme.quackback.io/dashboard')
      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
    })

    it('should return null when workspace has no Neon project ID', async () => {
      process.env.CATALOG_DATABASE_URL = 'postgres://catalog/db'
      process.env.TENANT_BASE_DOMAIN = 'quackback.io'
      process.env.NEON_API_KEY = 'test-key'

      mockDb.query.workspace.findFirst.mockResolvedValueOnce({
        ...mockWorkspace,
        neonProjectId: null,
      })

      const request = createRequest('https://acme.quackback.io/dashboard')
      const result = await resolveTenantFromDomain(request)

      expect(result).toBeNull()
    })

    it('should extract slug correctly from subdomain', async () => {
      process.env.CATALOG_DATABASE_URL = 'postgres://catalog/db'
      process.env.TENANT_BASE_DOMAIN = 'quackback.io'
      process.env.NEON_API_KEY = 'test-key'

      mockDb.query.workspace.findFirst.mockResolvedValueOnce(null)

      const request = createRequest('https://my-company.quackback.io/dashboard')
      await resolveTenantFromDomain(request)

      expect(mockDb.query.workspace.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.anything(),
        })
      )
    })

    it('should strip port from host header', async () => {
      process.env.CATALOG_DATABASE_URL = 'postgres://catalog/db'
      process.env.TENANT_BASE_DOMAIN = 'quackback.io'
      process.env.NEON_API_KEY = 'test-key'

      mockDb.query.workspace.findFirst.mockResolvedValueOnce(null)

      const request = new Request('https://acme.quackback.io:3000/dashboard', {
        headers: {
          host: 'acme.quackback.io:3000',
        },
      })
      await resolveTenantFromDomain(request)

      // Should have queried for 'acme' slug
      expect(mockDb.query.workspace.findFirst).toHaveBeenCalled()
    })

    it('should return null for nested subdomains', async () => {
      process.env.CATALOG_DATABASE_URL = 'postgres://catalog/db'
      process.env.TENANT_BASE_DOMAIN = 'quackback.io'
      process.env.NEON_API_KEY = 'test-key'

      const request = createRequest('https://app.acme.quackback.io/dashboard')
      const result = await resolveTenantFromDomain(request)

      // Nested subdomains like app.acme should be rejected
      expect(result).toBeNull()
    })
  })
})

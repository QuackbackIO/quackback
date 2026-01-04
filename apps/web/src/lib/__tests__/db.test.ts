/**
 * Tests for database connection module
 *
 * Tests self-hosted mode (DATABASE_URL singleton).
 * Cloud multi-tenant tests are skipped because they require the actual
 * server.ts module which has complex dependencies. Cloud mode is tested
 * via integration tests instead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Store original env
const originalEnv = { ...process.env }

// Hoist the mock factory so it's available before module imports
const { mockCreateDb } = vi.hoisted(() => {
  const mockDb = { query: {}, _mock: true }
  return {
    mockCreateDb: vi.fn(() => mockDb),
  }
})

// Mock createDb
vi.mock('@quackback/db/client', () => ({
  createDb: mockCreateDb,
}))

describe('db module', () => {
  beforeEach(() => {
    mockCreateDb.mockClear()
    vi.resetModules()
    // Reset globalThis.__db
    delete (globalThis as Record<string, unknown>).__db
    // Reset environment
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    delete (globalThis as Record<string, unknown>).__db
  })

  describe('Self-hosted mode (no TENANT_API_URL)', () => {
    it('should create singleton database from DATABASE_URL', async () => {
      delete process.env.TENANT_API_URL
      process.env.DATABASE_URL = 'postgres://localhost/quackback'

      const { db } = await import('../db')

      // Access db to trigger initialization
      const query = db.query

      expect(mockCreateDb).toHaveBeenCalledTimes(1)
      expect(mockCreateDb).toHaveBeenCalledWith('postgres://localhost/quackback', { max: 50 })
      expect(query).toBeDefined()
    })

    it('should reuse singleton on subsequent accesses', async () => {
      delete process.env.TENANT_API_URL
      process.env.DATABASE_URL = 'postgres://localhost/quackback'

      const { db } = await import('../db')

      // Access multiple times - void to satisfy linter
      void db.query
      void db.query
      void db.query

      expect(mockCreateDb).toHaveBeenCalledTimes(1)
    })

    it('should throw error when DATABASE_URL not set', async () => {
      delete process.env.TENANT_API_URL
      delete process.env.DATABASE_URL

      const { db } = await import('../db')

      expect(() => db.query).toThrow('DATABASE_URL environment variable is required')
    })
  })

  describe('db proxy behavior', () => {
    it('should lazily access database on property access', async () => {
      delete process.env.TENANT_API_URL
      process.env.DATABASE_URL = 'postgres://localhost/quackback'

      const { db } = await import('../db')

      // Just importing should not create db
      expect(mockCreateDb).not.toHaveBeenCalled()

      // Accessing a property should trigger creation
      void db.query
      expect(mockCreateDb).toHaveBeenCalledTimes(1)
    })
  })

  // Note: Cloud multi-tenant tests require integration testing with the actual
  // server.ts module because vitest's ESM mocking doesn't work well with
  // require() calls. The cloud mode is tested via:
  // 1. E2E tests with the full server running
  // 2. The resolver and db-cache unit tests which cover the tenant resolution logic
})

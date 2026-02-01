/**
 * Tests for database connection module
 *
 * Tests self-hosted mode with DATABASE_URL singleton connection.
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

  describe('Self-hosted mode', () => {
    it('should create singleton database from DATABASE_URL', async () => {
      process.env.DATABASE_URL = 'postgres://localhost/quackback'

      const { db } = await import('../db')

      // Access db to trigger initialization
      const query = db.query

      expect(mockCreateDb).toHaveBeenCalledTimes(1)
      expect(mockCreateDb).toHaveBeenCalledWith('postgres://localhost/quackback', { max: 50 })
      expect(query).toBeDefined()
    })

    it('should reuse singleton on subsequent accesses', async () => {
      process.env.DATABASE_URL = 'postgres://localhost/quackback'

      const { db } = await import('../db')

      // Access multiple times - void to satisfy linter
      void db.query
      void db.query
      void db.query

      expect(mockCreateDb).toHaveBeenCalledTimes(1)
    })

    it('should throw error when DATABASE_URL not set', async () => {
      delete (process.env as Record<string, string | undefined>).DATABASE_URL

      const { db } = await import('../db')

      expect(() => db.query).toThrow('DATABASE_URL environment variable is required')
    })
  })

  describe('db proxy behavior', () => {
    it('should lazily access database on property access', async () => {
      process.env.DATABASE_URL = 'postgres://localhost/quackback'

      const { db } = await import('../db')

      // Just importing should not create db
      expect(mockCreateDb).not.toHaveBeenCalled()

      // Accessing a property should trigger creation
      void db.query
      expect(mockCreateDb).toHaveBeenCalledTimes(1)
    })
  })
})

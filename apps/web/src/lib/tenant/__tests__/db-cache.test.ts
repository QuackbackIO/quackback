/**
 * Tests for tenant database connection cache
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoist the mock factory so it's available before module imports
const { mockNeon, mockDrizzle, mockDecrypt } = vi.hoisted(() => {
  return {
    mockNeon: vi.fn(() => ({})),
    // Return a new object for each call to simulate unique db instances
    mockDrizzle: vi.fn(() => ({
      query: {},
      _mock: true,
    })),
    // Mock decrypt to just return the input (pretend it's already decrypted)
    mockDecrypt: vi.fn((encrypted: string) => Promise.resolve(encrypted)),
  }
})

// Mock @neondatabase/serverless
vi.mock('@neondatabase/serverless', () => ({
  neon: mockNeon,
}))

// Mock drizzle-orm/neon-http
vi.mock('drizzle-orm/neon-http', () => ({
  drizzle: mockDrizzle,
}))

// Mock the catalog decrypt function
vi.mock('@/lib/catalog', () => ({
  decryptConnectionString: mockDecrypt,
}))

// Import after mocking
import { getTenantDb, clearTenantDb, clearAllTenantDbs } from '../db-cache'

describe('db-cache', () => {
  beforeEach(() => {
    // Clear all caches and mocks before each test
    clearAllTenantDbs()
    vi.clearAllMocks()
  })

  describe('getTenantDb', () => {
    it('should create a new database connection on first call', async () => {
      const db = await getTenantDb('workspace_123', 'encrypted:conn:string1')

      expect(mockDecrypt).toHaveBeenCalledTimes(1)
      expect(mockDecrypt).toHaveBeenCalledWith('encrypted:conn:string1', 'workspace_123')
      expect(mockNeon).toHaveBeenCalledTimes(1)
      expect(mockNeon).toHaveBeenCalledWith('encrypted:conn:string1')
      expect(mockDrizzle).toHaveBeenCalledTimes(1)
      expect(db).toBeDefined()
    })

    it('should return cached connection on subsequent calls with same workspaceId', async () => {
      const db1 = await getTenantDb('workspace_123', 'encrypted:conn:string1')
      const db2 = await getTenantDb('workspace_123', 'encrypted:conn:string1')

      // Decryption should only happen once (cache hit on second call)
      expect(mockDecrypt).toHaveBeenCalledTimes(1)
      expect(mockNeon).toHaveBeenCalledTimes(1)
      expect(db1).toBe(db2)
    })

    it('should create separate connections for different workspaceIds', async () => {
      const db1 = await getTenantDb('workspace_123', 'encrypted:conn:string1')
      const db2 = await getTenantDb('workspace_456', 'encrypted:conn:string2')

      expect(mockDecrypt).toHaveBeenCalledTimes(2)
      expect(mockNeon).toHaveBeenCalledTimes(2)
      expect(db1).not.toBe(db2)
    })

    it('should create new connection when encrypted connection string changes', async () => {
      const db1 = await getTenantDb('workspace_123', 'encrypted:conn:string1')
      const db2 = await getTenantDb('workspace_123', 'encrypted:rotated:string')

      expect(mockDecrypt).toHaveBeenCalledTimes(2)
      expect(mockNeon).toHaveBeenCalledTimes(2)
      expect(db1).not.toBe(db2)
      // Verify the new connection uses the new connection string
      expect(mockDecrypt).toHaveBeenLastCalledWith('encrypted:rotated:string', 'workspace_123')
    })

    it('should keep returning same connection if encrypted connection string unchanged', async () => {
      const encConnString = 'encrypted:conn:string1'
      const db1 = await getTenantDb('workspace_123', encConnString)
      const db2 = await getTenantDb('workspace_123', encConnString)
      const db3 = await getTenantDb('workspace_123', encConnString)

      // Only decrypt once (cache hits on subsequent calls)
      expect(mockDecrypt).toHaveBeenCalledTimes(1)
      expect(mockNeon).toHaveBeenCalledTimes(1)
      expect(db1).toBe(db2)
      expect(db2).toBe(db3)
    })
  })

  describe('clearTenantDb', () => {
    it('should remove specific tenant from cache', async () => {
      await getTenantDb('workspace_123', 'encrypted:conn:string1')
      await getTenantDb('workspace_456', 'encrypted:conn:string2')

      expect(mockDecrypt).toHaveBeenCalledTimes(2)

      clearTenantDb('workspace_123')

      // Getting workspace_123 again should create new connection (and decrypt)
      await getTenantDb('workspace_123', 'encrypted:conn:string1')
      expect(mockDecrypt).toHaveBeenCalledTimes(3)

      // Getting workspace_456 should still use cached (no additional decrypt)
      await getTenantDb('workspace_456', 'encrypted:conn:string2')
      expect(mockDecrypt).toHaveBeenCalledTimes(3)
    })
  })

  describe('clearAllTenantDbs', () => {
    it('should remove all tenants from cache', async () => {
      await getTenantDb('workspace_123', 'encrypted:conn:string1')
      await getTenantDb('workspace_456', 'encrypted:conn:string2')

      expect(mockDecrypt).toHaveBeenCalledTimes(2)

      clearAllTenantDbs()

      // Both should create new connections (and decrypt again)
      await getTenantDb('workspace_123', 'encrypted:conn:string1')
      await getTenantDb('workspace_456', 'encrypted:conn:string2')

      expect(mockDecrypt).toHaveBeenCalledTimes(4)
    })
  })

  describe('capacity limits', () => {
    it('should handle up to 100 connections', async () => {
      // Create 100 connections (the max)
      for (let i = 0; i < 100; i++) {
        await getTenantDb(`workspace_${i}`, `encrypted:conn:string${i}`)
      }
      expect(mockDecrypt).toHaveBeenCalledTimes(100)

      // All 100 should be cached when accessed again (no additional decrypt)
      for (let i = 0; i < 100; i++) {
        await getTenantDb(`workspace_${i}`, `encrypted:conn:string${i}`)
      }
      expect(mockDecrypt).toHaveBeenCalledTimes(100) // All still cached
    })
  })
})

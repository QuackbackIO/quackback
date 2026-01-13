/**
 * Tests for tenant database connection cache
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoist the mock factory so it's available before module imports
const { mockNeon, mockDrizzle } = vi.hoisted(() => {
  return {
    mockNeon: vi.fn(() => ({})),
    // Return a new object for each call to simulate unique db instances
    mockDrizzle: vi.fn(() => ({
      query: {},
      _mock: true,
    })),
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

// Import after mocking
import { getTenantDb, clearTenantDb, clearAllTenantDbs } from '../db-cache'

describe('db-cache', () => {
  beforeEach(() => {
    // Clear all caches and mocks before each test
    clearAllTenantDbs()
    vi.clearAllMocks()
  })

  describe('getTenantDb', () => {
    it('should create a new database connection on first call', () => {
      const db = getTenantDb('workspace_123', 'postgres://host/db1')

      expect(mockNeon).toHaveBeenCalledTimes(1)
      expect(mockNeon).toHaveBeenCalledWith('postgres://host/db1')
      expect(mockDrizzle).toHaveBeenCalledTimes(1)
      expect(db).toBeDefined()
    })

    it('should return cached connection on subsequent calls with same workspaceId', () => {
      const db1 = getTenantDb('workspace_123', 'postgres://host/db1')
      const db2 = getTenantDb('workspace_123', 'postgres://host/db1')

      expect(mockNeon).toHaveBeenCalledTimes(1)
      expect(db1).toBe(db2)
    })

    it('should create separate connections for different workspaceIds', () => {
      const db1 = getTenantDb('workspace_123', 'postgres://host/db1')
      const db2 = getTenantDb('workspace_456', 'postgres://host/db2')

      expect(mockNeon).toHaveBeenCalledTimes(2)
      expect(db1).not.toBe(db2)
    })

    it('should create new connection when connection string changes', () => {
      const db1 = getTenantDb('workspace_123', 'postgres://host/db1')
      const db2 = getTenantDb('workspace_123', 'postgres://host/db2-rotated')

      expect(mockNeon).toHaveBeenCalledTimes(2)
      expect(db1).not.toBe(db2)
      // Verify the new connection uses the new connection string
      expect(mockNeon).toHaveBeenLastCalledWith('postgres://host/db2-rotated')
    })

    it('should keep returning same connection if connection string unchanged', () => {
      const connString = 'postgres://host/db1'
      const db1 = getTenantDb('workspace_123', connString)
      const db2 = getTenantDb('workspace_123', connString)
      const db3 = getTenantDb('workspace_123', connString)

      expect(mockNeon).toHaveBeenCalledTimes(1)
      expect(db1).toBe(db2)
      expect(db2).toBe(db3)
    })
  })

  describe('clearTenantDb', () => {
    it('should remove specific tenant from cache', () => {
      getTenantDb('workspace_123', 'postgres://host/db1')
      getTenantDb('workspace_456', 'postgres://host/db2')

      expect(mockNeon).toHaveBeenCalledTimes(2)

      clearTenantDb('workspace_123')

      // Getting workspace_123 again should create new connection
      getTenantDb('workspace_123', 'postgres://host/db1')
      expect(mockNeon).toHaveBeenCalledTimes(3)

      // Getting workspace_456 should still use cached
      getTenantDb('workspace_456', 'postgres://host/db2')
      expect(mockNeon).toHaveBeenCalledTimes(3)
    })
  })

  describe('clearAllTenantDbs', () => {
    it('should remove all tenants from cache', () => {
      getTenantDb('workspace_123', 'postgres://host/db1')
      getTenantDb('workspace_456', 'postgres://host/db2')

      expect(mockNeon).toHaveBeenCalledTimes(2)

      clearAllTenantDbs()

      // Both should create new connections
      getTenantDb('workspace_123', 'postgres://host/db1')
      getTenantDb('workspace_456', 'postgres://host/db2')

      expect(mockNeon).toHaveBeenCalledTimes(4)
    })
  })

  describe('capacity limits', () => {
    it('should handle up to 100 connections', () => {
      // Create 100 connections (the max)
      for (let i = 0; i < 100; i++) {
        getTenantDb(`workspace_${i}`, `postgres://host/db${i}`)
      }
      expect(mockNeon).toHaveBeenCalledTimes(100)

      // All 100 should be cached when accessed again
      for (let i = 0; i < 100; i++) {
        getTenantDb(`workspace_${i}`, `postgres://host/db${i}`)
      }
      expect(mockNeon).toHaveBeenCalledTimes(100) // All still cached
    })
  })
})

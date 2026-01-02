/**
 * Tests for EE module loader
 *
 * These tests verify the conditional loading behavior of EE modules.
 * Note: Tests that require actual EE packages to be loaded may be skipped
 * in environments where dynamic imports don't resolve workspace packages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the license module before importing the loader
vi.mock('@/lib/license/license.server', () => ({
  hasEnterpriseLicense: vi.fn(),
}))

import { loadEEModule, isEEModuleAvailable, getAvailableEEModules } from '../loader'
import { hasEnterpriseLicense } from '@/lib/license/license.server'

const mockHasEnterpriseLicense = vi.mocked(hasEnterpriseLicense)

describe('EE Module Loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loadEEModule', () => {
    it('returns no_license when enterprise license is not present', async () => {
      mockHasEnterpriseLicense.mockResolvedValue(false)

      const result = await loadEEModule('sso')

      expect(result).toEqual({
        available: false,
        reason: 'no_license',
      })
      expect(mockHasEnterpriseLicense).toHaveBeenCalledOnce()
    })

    it('checks license before attempting import', async () => {
      mockHasEnterpriseLicense.mockResolvedValue(false)

      await loadEEModule('sso')
      await loadEEModule('scim')
      await loadEEModule('audit')

      // License should be checked for each call
      expect(mockHasEnterpriseLicense).toHaveBeenCalledTimes(3)
    })

    it('returns not_installed when package is not found', async () => {
      mockHasEnterpriseLicense.mockResolvedValue(true)

      // This will fail to import because @quackback/ee-nonexistent doesn't exist
      const result = await loadEEModule('nonexistent')

      expect(result).toEqual({
        available: false,
        reason: 'not_installed',
      })
    })

    it('attempts dynamic import when licensed', async () => {
      mockHasEnterpriseLicense.mockResolvedValue(true)

      // With valid license, loader should attempt import
      // The result depends on whether vitest can resolve workspace packages
      const result = await loadEEModule('sso')

      // Either it loads successfully or reports not_installed
      // (not no_license, since we have a license)
      if (!result.available) {
        expect(result.reason).toBe('not_installed')
      } else {
        expect(result.module).toBeDefined()
      }
    })
  })

  describe('isEEModuleAvailable', () => {
    it('returns false when not licensed', async () => {
      mockHasEnterpriseLicense.mockResolvedValue(false)

      const available = await isEEModuleAvailable('sso')

      expect(available).toBe(false)
    })

    it('returns false when licensed but not installed', async () => {
      mockHasEnterpriseLicense.mockResolvedValue(true)

      const available = await isEEModuleAvailable('nonexistent')

      expect(available).toBe(false)
    })

    it('returns boolean based on license and package availability', async () => {
      mockHasEnterpriseLicense.mockResolvedValue(true)

      const available = await isEEModuleAvailable('sso')

      expect(typeof available).toBe('boolean')
    })
  })

  describe('getAvailableEEModules', () => {
    it('returns all false when not licensed', async () => {
      mockHasEnterpriseLicense.mockResolvedValue(false)

      const modules = await getAvailableEEModules()

      expect(modules).toEqual({
        sso: false,
        scim: false,
        audit: false,
      })
    })

    it('returns object with expected keys when licensed', async () => {
      mockHasEnterpriseLicense.mockResolvedValue(true)

      const modules = await getAvailableEEModules()

      // Verify structure
      expect(modules).toHaveProperty('sso')
      expect(modules).toHaveProperty('scim')
      expect(modules).toHaveProperty('audit')

      // All should be booleans
      expect(typeof modules.sso).toBe('boolean')
      expect(typeof modules.scim).toBe('boolean')
      expect(typeof modules.audit).toBe('boolean')
    })

    it('checks all three modules in parallel', async () => {
      mockHasEnterpriseLicense.mockResolvedValue(true)

      await getAvailableEEModules()

      // 3 calls from getAvailableEEModules (one for each module)
      // Each calls isEEModuleAvailable which calls loadEEModule which calls hasEnterpriseLicense
      expect(mockHasEnterpriseLicense).toHaveBeenCalledTimes(3)
    })
  })

  describe('EEModuleResult type discriminated union', () => {
    it('can be narrowed based on available property', async () => {
      mockHasEnterpriseLicense.mockResolvedValue(false)

      const result = await loadEEModule('sso')

      if (result.available) {
        // TypeScript should know result.module exists here
        expect(result.module).toBeDefined()
      } else {
        // TypeScript should know result.reason exists here
        expect(['no_license', 'not_installed']).toContain(result.reason)
      }
    })
  })
})

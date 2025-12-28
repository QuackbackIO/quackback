/**
 * HookRegistry Tests
 *
 * Tests for the core hook registry functionality including:
 * - Filter hooks (data transformation)
 * - Action hooks (side effects)
 * - Validation filters (reject operations)
 * - Priority ordering
 * - Hook removal
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HookRegistry } from '../registry'
import { PRIORITY } from '../types'
import { ok, err } from '../../shared/result'
import type { HookContext } from '../types'
import type { ServiceContext } from '../../shared/service-context'

// Helper to create a mock service context
function createMockContext(): HookContext {
  const serviceContext: ServiceContext = {
    userId: 'user_test123' as any,
    memberId: 'member_test123' as any,
    memberRole: 'user',
    userName: 'Test User',
    userEmail: 'test@example.com',
  }

  return {
    service: serviceContext,
    hookName: 'test.hook',
    metadata: {},
  }
}

describe('HookRegistry', () => {
  let registry: HookRegistry

  beforeEach(() => {
    registry = new HookRegistry()
  })

  describe('Filter Hooks', () => {
    it('should execute filter hooks sequentially', async () => {
      const ctx = createMockContext()

      // Add filters that transform a number
      registry.addFilter('test.filter', (value: number) => value + 1, PRIORITY.NORMAL, 'add-one')
      registry.addFilter('test.filter', (value: number) => value * 2, PRIORITY.NORMAL, 'multiply')

      const result = await registry.applyFilters('test.filter', 5, ctx)

      // Filters run sequentially: (5 + 1) * 2 = 12
      expect(result).toBe(12)
    })

    it('should respect priority ordering in filters', async () => {
      const ctx = createMockContext()

      // Add filters in reverse priority order
      registry.addFilter('test.filter', (value: number) => value * 2, PRIORITY.LOW, 'multiply')
      registry.addFilter('test.filter', (value: number) => value + 1, PRIORITY.HIGH, 'add-one')

      const result = await registry.applyFilters('test.filter', 5, ctx)

      // High priority runs first: (5 + 1) * 2 = 12
      expect(result).toBe(12)
    })

    it('should handle async filters', async () => {
      const ctx = createMockContext()

      registry.addFilter(
        'test.filter',
        async (value: string) => {
          return new Promise((resolve) => {
            setTimeout(() => resolve(value.toUpperCase()), 10)
          })
        },
        PRIORITY.NORMAL,
        'uppercase'
      )

      const result = await registry.applyFilters('test.filter', 'hello', ctx)
      expect(result).toBe('HELLO')
    })

    it('should continue with other filters if one throws', async () => {
      const ctx = createMockContext()
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      registry.addFilter(
        'test.filter',
        () => {
          throw new Error('Filter error')
        },
        PRIORITY.HIGH,
        'failing-filter'
      )
      registry.addFilter('test.filter', (value: number) => value + 1, PRIORITY.NORMAL, 'add-one')

      const result = await registry.applyFilters('test.filter', 5, ctx)

      // Should continue with original value after failed filter
      expect(result).toBe(6)
      expect(consoleError).toHaveBeenCalled()

      consoleError.mockRestore()
    })

    it('should return original value if no filters registered', async () => {
      const ctx = createMockContext()
      const result = await registry.applyFilters('nonexistent.filter', 42, ctx)
      expect(result).toBe(42)
    })
  })

  describe('Action Hooks', () => {
    it('should execute action hooks in parallel', async () => {
      const ctx = createMockContext()
      const executionOrder: number[] = []

      registry.addAction(
        'test.action',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          executionOrder.push(1)
        },
        PRIORITY.NORMAL,
        'action-1'
      )

      registry.addAction(
        'test.action',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          executionOrder.push(2)
        },
        PRIORITY.NORMAL,
        'action-2'
      )

      await registry.doActions('test.action', {}, ctx)

      // Both should execute, and faster one completes first
      expect(executionOrder).toContain(1)
      expect(executionOrder).toContain(2)
    })

    it('should not throw if action fails', async () => {
      const ctx = createMockContext()
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      registry.addAction(
        'test.action',
        () => {
          throw new Error('Action error')
        },
        PRIORITY.NORMAL,
        'failing-action'
      )

      // Should not throw
      await expect(registry.doActions('test.action', {}, ctx)).resolves.toBeUndefined()
      expect(consoleError).toHaveBeenCalled()

      consoleError.mockRestore()
    })

    it('should execute void action hooks', async () => {
      const ctx = createMockContext()
      const spy = vi.fn()

      registry.addAction('test.action', spy, PRIORITY.NORMAL, 'spy-action')

      await registry.doActions('test.action', { data: 'test' }, ctx)

      expect(spy).toHaveBeenCalledWith({ data: 'test' }, ctx)
    })

    it('should do nothing if no actions registered', async () => {
      const ctx = createMockContext()
      await expect(
        registry.doActions('nonexistent.action', {}, ctx)
      ).resolves.toBeUndefined()
    })
  })

  describe('Validation Filters', () => {
    it('should stop on first validation failure', async () => {
      const ctx = createMockContext()
      const secondValidator = vi.fn()

      registry.addValidation(
        'test.validate',
        async (value: string) => {
          if (value.length < 3) {
            return err({ code: 'TOO_SHORT', message: 'Value too short' })
          }
          return ok(value)
        },
        PRIORITY.HIGH,
        'check-length'
      )

      registry.addValidation(
        'test.validate',
        async (value: string) => {
          secondValidator()
          return ok(value)
        },
        PRIORITY.NORMAL,
        'second-check'
      )

      const result = await registry.applyValidations('test.validate', 'ab', ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('TOO_SHORT')
      }
      // Second validator should not run
      expect(secondValidator).not.toHaveBeenCalled()
    })

    it('should return success if all validations pass', async () => {
      const ctx = createMockContext()

      registry.addValidation(
        'test.validate',
        async (value: string) => {
          if (value.length < 3) {
            return err({ code: 'TOO_SHORT', message: 'Value too short' })
          }
          return ok(value)
        },
        PRIORITY.HIGH,
        'check-length'
      )

      registry.addValidation(
        'test.validate',
        async (value: string) => {
          if (!value.includes('@')) {
            return err({ code: 'NO_AT_SIGN', message: 'Missing @ sign' })
          }
          return ok(value)
        },
        PRIORITY.NORMAL,
        'check-at-sign'
      )

      const result = await registry.applyValidations('test.validate', 'test@example', ctx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBe('test@example')
      }
    })

    it('should handle validation exceptions', async () => {
      const ctx = createMockContext()

      registry.addValidation(
        'test.validate',
        () => {
          throw new Error('Validation crashed')
        },
        PRIORITY.NORMAL,
        'crashing-validator'
      )

      const result = await registry.applyValidations('test.validate', 'test', ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('HOOK_EXECUTION_FAILED')
      }
    })

    it('should allow validators to transform value', async () => {
      const ctx = createMockContext()

      registry.addValidation(
        'test.validate',
        async (value: string) => {
          // Trim whitespace
          return ok(value.trim())
        },
        PRIORITY.HIGH,
        'trim'
      )

      registry.addValidation(
        'test.validate',
        async (value: string) => {
          // Lowercase
          return ok(value.toLowerCase())
        },
        PRIORITY.NORMAL,
        'lowercase'
      )

      const result = await registry.applyValidations('test.validate', '  HELLO  ', ctx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBe('hello')
      }
    })

    it('should return success if no validations registered', async () => {
      const ctx = createMockContext()
      const result = await registry.applyValidations('nonexistent.validate', 'test', ctx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toBe('test')
      }
    })
  })

  describe('Hook Removal', () => {
    it('should remove filter by ID', () => {
      registry.addFilter('test.filter', (v: number) => v + 1, PRIORITY.NORMAL, 'my-filter')

      const removed = registry.removeFilter('test.filter', 'my-filter')
      expect(removed).toBe(true)

      const hooks = registry.getRegisteredHooks()
      expect(hooks.filters).not.toContain('test.filter')
    })

    it('should remove action by ID', () => {
      registry.addAction('test.action', () => {}, PRIORITY.NORMAL, 'my-action')

      const removed = registry.removeAction('test.action', 'my-action')
      expect(removed).toBe(true)

      const hooks = registry.getRegisteredHooks()
      expect(hooks.actions).not.toContain('test.action')
    })

    it('should remove validation by ID', () => {
      registry.addValidation(
        'test.validate',
        async (v) => ok(v),
        PRIORITY.NORMAL,
        'my-validation'
      )

      const removed = registry.removeValidation('test.validate', 'my-validation')
      expect(removed).toBe(true)

      const hooks = registry.getRegisteredHooks()
      expect(hooks.validations).not.toContain('test.validate')
    })

    it('should return false when removing non-existent hook', () => {
      const removed = registry.removeFilter('nonexistent.filter', 'fake-id')
      expect(removed).toBe(false)
    })

    it('should keep other hooks when removing one', () => {
      registry.addFilter('test.filter', (v: number) => v + 1, PRIORITY.NORMAL, 'filter-1')
      registry.addFilter('test.filter', (v: number) => v * 2, PRIORITY.NORMAL, 'filter-2')

      registry.removeFilter('test.filter', 'filter-1')

      const hooks = registry.getRegisteredHooks()
      expect(hooks.filters).toContain('test.filter')
    })
  })

  describe('Clear', () => {
    it('should clear all hooks', () => {
      registry.addFilter('test.filter', (v) => v, PRIORITY.NORMAL)
      registry.addAction('test.action', () => {}, PRIORITY.NORMAL)
      registry.addValidation('test.validate', async (v) => ok(v), PRIORITY.NORMAL)

      registry.clear()

      const hooks = registry.getRegisteredHooks()
      expect(hooks.filters).toHaveLength(0)
      expect(hooks.actions).toHaveLength(0)
      expect(hooks.validations).toHaveLength(0)
    })
  })

  describe('GetRegisteredHooks', () => {
    it('should return all registered hook names', () => {
      registry.addFilter('filter.one', (v) => v, PRIORITY.NORMAL)
      registry.addFilter('filter.two', (v) => v, PRIORITY.NORMAL)
      registry.addAction('action.one', () => {}, PRIORITY.NORMAL)
      registry.addValidation('validate.one', async (v) => ok(v), PRIORITY.NORMAL)

      const hooks = registry.getRegisteredHooks()

      expect(hooks.filters).toContain('filter.one')
      expect(hooks.filters).toContain('filter.two')
      expect(hooks.actions).toContain('action.one')
      expect(hooks.validations).toContain('validate.one')
    })
  })
})

/**
 * Hook Registry
 *
 * Central registry for managing filters, actions, and validations.
 * Provides WordPress-style hook system with priority-based ordering.
 */

import { ok, err, type Result } from '../shared/result'
import type {
  FilterHook,
  ActionHook,
  ValidationFilter,
  HookHandler,
  HookContext,
  Priority,
  HookError,
} from './types'

/**
 * Registry for managing all hooks in the application
 *
 * Singleton instance that maintains separate registries for:
 * - Filters: Transform data sequentially
 * - Actions: Execute side effects in parallel
 * - Validations: Validate data and potentially reject operations
 */
export class HookRegistry {
  private filters = new Map<string, HookHandler<FilterHook<any>>[]>()
  private actions = new Map<string, HookHandler<ActionHook<any>>[]>()
  private validations = new Map<string, HookHandler<ValidationFilter<any, any>>[]>()

  /**
   * Register a filter hook
   *
   * Filters transform data and run sequentially in priority order.
   * Each filter receives the output of the previous filter.
   *
   * @param hookName - Name of the hook (e.g., 'post.beforeCreate')
   * @param handler - Filter function to execute
   * @param priority - Execution priority (lower = earlier, default: 10)
   * @param id - Unique identifier (auto-generated if not provided)
   */
  addFilter<T>(
    hookName: string,
    handler: FilterHook<T>,
    priority: Priority = 10,
    id?: string
  ): void {
    const hookId = id || this.generateId(hookName)
    const handlers = this.filters.get(hookName) || []

    handlers.push({
      handler: handler as FilterHook<any>,
      priority: typeof priority === 'number' ? priority : priority,
      id: hookId,
    })

    // Sort by priority (ascending)
    handlers.sort((a, b) => a.priority - b.priority)

    this.filters.set(hookName, handlers)
  }

  /**
   * Register an action hook
   *
   * Actions execute side effects and run in parallel (fire-and-forget).
   * They cannot modify data and don't block the main execution flow.
   *
   * @param hookName - Name of the hook (e.g., 'post.afterCreate')
   * @param handler - Action function to execute
   * @param priority - Execution priority (lower = earlier, default: 10)
   * @param id - Unique identifier (auto-generated if not provided)
   */
  addAction<T>(
    hookName: string,
    handler: ActionHook<T>,
    priority: Priority = 10,
    id?: string
  ): void {
    const hookId = id || this.generateId(hookName)
    const handlers = this.actions.get(hookName) || []

    handlers.push({
      handler: handler as ActionHook<any>,
      priority: typeof priority === 'number' ? priority : priority,
      id: hookId,
    })

    // Sort by priority (ascending)
    handlers.sort((a, b) => a.priority - b.priority)

    this.actions.set(hookName, handlers)
  }

  /**
   * Register a validation filter
   *
   * Validations can reject operations by returning an error Result.
   * They run sequentially and stop at the first failure.
   *
   * @param hookName - Name of the hook (e.g., 'post.validateCreate')
   * @param handler - Validation function to execute
   * @param priority - Execution priority (lower = earlier, default: 10)
   * @param id - Unique identifier (auto-generated if not provided)
   */
  addValidation<T, E>(
    hookName: string,
    handler: ValidationFilter<T, E>,
    priority: Priority = 10,
    id?: string
  ): void {
    const hookId = id || this.generateId(hookName)
    const handlers = this.validations.get(hookName) || []

    handlers.push({
      handler: handler as ValidationFilter<any, any>,
      priority: typeof priority === 'number' ? priority : priority,
      id: hookId,
    })

    // Sort by priority (ascending)
    handlers.sort((a, b) => a.priority - b.priority)

    this.validations.set(hookName, handlers)
  }

  /**
   * Apply filters to transform a value
   *
   * Runs all registered filters for the given hook name sequentially.
   * Each filter receives the output of the previous filter.
   *
   * @param hookName - Name of the hook to execute
   * @param value - Initial value to transform
   * @param context - Hook execution context
   * @returns Transformed value after all filters
   */
  async applyFilters<T>(hookName: string, value: T, context: HookContext): Promise<T> {
    const handlers = this.filters.get(hookName) || []
    let result = value

    for (const { handler, id } of handlers) {
      try {
        result = await handler(result, context)
      } catch (error) {
        // Log error but continue with other filters
        console.error(`Filter hook ${hookName}:${id} failed:`, error)
        // Continue with unmodified value
      }
    }

    return result
  }

  /**
   * Apply validation filters
   *
   * Runs all registered validations for the given hook name sequentially.
   * Stops at the first validation that returns an error.
   *
   * @param hookName - Name of the hook to execute
   * @param value - Value to validate
   * @param context - Hook execution context
   * @returns Result containing validated value or first error
   */
  async applyValidations<T, E>(
    hookName: string,
    value: T,
    context: HookContext
  ): Promise<Result<T, E>> {
    const handlers = this.validations.get(hookName) || []

    for (const { handler, id } of handlers) {
      try {
        const result = await handler(value, context)
        if (!result.success) {
          return result
        }
        // Update value with validated/transformed version
        value = result.value
      } catch (error) {
        // Treat exceptions as validation failures
        return err({
          code: 'HOOK_EXECUTION_FAILED',
          message: `Validation hook ${hookName}:${id} failed`,
          hookName,
          hookId: id,
          cause: error,
        } as E)
      }
    }

    return ok(value)
  }

  /**
   * Execute action hooks
   *
   * Runs all registered actions for the given hook name in parallel.
   * Actions are fire-and-forget - they don't block execution or return values.
   *
   * @param hookName - Name of the hook to execute
   * @param data - Data to pass to action hooks
   * @param context - Hook execution context
   */
  async doActions<T>(hookName: string, data: T, context: HookContext): Promise<void> {
    const handlers = this.actions.get(hookName) || []

    // Execute all actions in parallel (fire-and-forget)
    const promises = handlers.map(async ({ handler, id }) => {
      try {
        await handler(data, context)
      } catch (error) {
        // Log error but don't propagate (actions shouldn't block execution)
        console.error(`Action hook ${hookName}:${id} failed:`, error)
      }
    })

    // Wait for all actions to complete (but ignore individual failures)
    await Promise.allSettled(promises)
  }

  /**
   * Remove a filter hook by ID
   *
   * @param hookName - Name of the hook
   * @param id - ID of the handler to remove
   * @returns true if handler was removed, false if not found
   */
  removeFilter(hookName: string, id: string): boolean {
    const handlers = this.filters.get(hookName)
    if (!handlers) return false

    const initialLength = handlers.length
    const filtered = handlers.filter((h) => h.id !== id)

    if (filtered.length === initialLength) return false

    if (filtered.length === 0) {
      this.filters.delete(hookName)
    } else {
      this.filters.set(hookName, filtered)
    }

    return true
  }

  /**
   * Remove an action hook by ID
   *
   * @param hookName - Name of the hook
   * @param id - ID of the handler to remove
   * @returns true if handler was removed, false if not found
   */
  removeAction(hookName: string, id: string): boolean {
    const handlers = this.actions.get(hookName)
    if (!handlers) return false

    const initialLength = handlers.length
    const filtered = handlers.filter((h) => h.id !== id)

    if (filtered.length === initialLength) return false

    if (filtered.length === 0) {
      this.actions.delete(hookName)
    } else {
      this.actions.set(hookName, filtered)
    }

    return true
  }

  /**
   * Remove a validation hook by ID
   *
   * @param hookName - Name of the hook
   * @param id - ID of the handler to remove
   * @returns true if handler was removed, false if not found
   */
  removeValidation(hookName: string, id: string): boolean {
    const handlers = this.validations.get(hookName)
    if (!handlers) return false

    const initialLength = handlers.length
    const filtered = handlers.filter((h) => h.id !== id)

    if (filtered.length === initialLength) return false

    if (filtered.length === 0) {
      this.validations.delete(hookName)
    } else {
      this.validations.set(hookName, filtered)
    }

    return true
  }

  /**
   * Get all registered hook names
   *
   * @returns Object containing arrays of registered hook names by type
   */
  getRegisteredHooks(): {
    filters: string[]
    actions: string[]
    validations: string[]
  } {
    return {
      filters: Array.from(this.filters.keys()),
      actions: Array.from(this.actions.keys()),
      validations: Array.from(this.validations.keys()),
    }
  }

  /**
   * Clear all hooks (useful for testing)
   */
  clear(): void {
    this.filters.clear()
    this.actions.clear()
    this.validations.clear()
  }

  /**
   * Generate a unique ID for a hook handler
   */
  private generateId(hookName: string): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 9)
    return `${hookName}:${timestamp}:${random}`
  }
}

/**
 * Global singleton instance of the hook registry
 */
export const hooks = new HookRegistry()

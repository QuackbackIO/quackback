/**
 * Hook System
 *
 * WordPress-inspired hook architecture for extending Quackback functionality
 * without modifying core service layer code.
 *
 * @example Basic usage
 * ```ts
 * import { hooks, HOOKS, PRIORITY } from '@quackback/domain/hooks'
 *
 * // Register a validation filter
 * hooks.addValidation(
 *   HOOKS.POST_VALIDATE_CREATE,
 *   async (input, ctx) => {
 *     if (await detectSpam(input.content)) {
 *       return err(PostError.validationError('Spam detected'))
 *     }
 *     return ok(input)
 *   },
 *   PRIORITY.HIGH
 * )
 *
 * // Register an action hook
 * hooks.addAction(
 *   HOOKS.POST_AFTER_CREATE,
 *   async (post, ctx) => {
 *     await analytics.track('post_created', { postId: post.id })
 *   },
 *   PRIORITY.LOW
 * )
 * ```
 *
 * @example Using plugins
 * ```ts
 * import { pluginManager, SpamFilterPlugin } from '@quackback/domain/hooks'
 *
 * const spamFilter = new SpamFilterPlugin()
 * pluginManager.registerPlugin(spamFilter)
 * await pluginManager.activatePlugin('spam-filter')
 * ```
 */

// Core types
export type {
  FilterHook,
  ActionHook,
  ValidationFilter,
  HookContext,
  HookHandler,
  HookError,
  Priority,
} from './types'

export { PRIORITY } from './types'

// Registry
export { HookRegistry, hooks } from './registry'

// Standard hook names
export { HOOKS, isValidHookName, type HookName } from './hooks'

// Plugin system
export { type HookPlugin, PluginManager } from './plugin'

// Global plugin manager instance
import { hooks } from './registry'
import { PluginManager } from './plugin'

export const pluginManager = new PluginManager(hooks)

// Initialization utilities
export { initializeHooks, shutdownHooks, getHookSystemStatus } from './init'
export type { HookSystemConfig } from './init'

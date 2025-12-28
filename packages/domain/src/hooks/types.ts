/**
 * Hook System Types
 *
 * WordPress-inspired hook architecture providing filters, actions, and validations
 * for extending core functionality without modifying service layer code.
 */

import type { Result } from '../shared/result'
import type { ServiceContext } from '../shared/service-context'

/**
 * Context provided to all hook handlers
 * Contains service execution context and hook-specific metadata
 */
export interface HookContext {
  /** Service execution context (user, role, etc.) */
  service: ServiceContext
  /** Name of the hook being executed */
  hookName: string
  /** Optional metadata for hook-specific data */
  metadata?: Record<string, unknown>
}

/**
 * Filter Hook: Transform data before/after operations
 *
 * Filters run sequentially in priority order and each can transform the data.
 * The output of one filter becomes the input to the next.
 *
 * @example
 * ```ts
 * const enrichContent: FilterHook<CreatePostInput> = async (input, ctx) => ({
 *   ...input,
 *   content: linkifyUrls(input.content)
 * })
 * ```
 */
export type FilterHook<T> = (value: T, context: HookContext) => T | Promise<T>

/**
 * Action Hook: Execute side effects (notifications, analytics, integrations)
 *
 * Actions run in parallel by default (fire-and-forget) and cannot modify data.
 * Use for notifications, event logging, analytics, external API calls.
 *
 * @example
 * ```ts
 * const notifySlack: ActionHook<Post> = async (post, ctx) => {
 *   await slack.postMessage({
 *     channel: '#feedback',
 *     text: `New post: ${post.title}`
 *   })
 * }
 * ```
 */
export type ActionHook<T> = (data: T, context: HookContext) => void | Promise<void>

/**
 * Validation Filter: Validate data and potentially reject operations
 *
 * Validations run sequentially and can prevent operations by returning an error.
 * Execution stops at the first validation failure.
 *
 * @example
 * ```ts
 * const checkSpam: ValidationFilter<CreatePostInput, PostError> = async (input, ctx) => {
 *   const isSpam = await detectSpam(input.content)
 *   if (isSpam) {
 *     return err(PostError.validationError('Spam detected'))
 *   }
 *   return ok(input)
 * }
 * ```
 */
export type ValidationFilter<T, E> = (
  value: T,
  context: HookContext
) => Result<T, E> | Promise<Result<T, E>>

/**
 * Priority levels for hook execution order
 * Lower numbers run first (WordPress convention)
 */
export const PRIORITY = {
  /** Critical hooks that must run first (security, authentication) */
  CRITICAL: 1,
  /** High priority (data validation, spam detection) */
  HIGH: 5,
  /** Normal priority (default for most hooks) */
  NORMAL: 10,
  /** Low priority (analytics, logging) */
  LOW: 20,
  /** Lowest priority (cleanup, background tasks) */
  LOWEST: 100,
} as const

export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY] | number

/**
 * Internal hook handler with priority and ID
 */
export interface HookHandler<T> {
  /** The hook function to execute */
  handler: T
  /** Execution priority (lower = earlier) */
  priority: number
  /** Unique identifier for this hook (for removal/debugging) */
  id: string
}

/**
 * Generic hook error for when hooks fail
 */
export interface HookError {
  code: 'HOOK_EXECUTION_FAILED'
  message: string
  hookName: string
  hookId: string
  cause?: unknown
}

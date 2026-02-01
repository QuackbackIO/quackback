/**
 * Event system barrel exports.
 *
 * IMPORTANT: This barrel only exports types.
 * For dispatching events, import directly from './dispatch.js' in server-only code.
 */

export * from './types'

// Re-export hook types for consumers
export type {
  HookHandler,
  HookResult,
  HookTarget,
  TestResult,
  ProcessResult,
  SlackTarget,
  SlackConfig,
  EmailTarget,
  EmailConfig,
} from './hook-types'

export type { NotificationTarget, NotificationConfig } from './handlers/notification'
export type { WebhookTarget, WebhookConfig } from './handlers/webhook'

// Export registry functions
export { getHook, registerHook } from './registry'

/**
 * Event system barrel exports.
 *
 * For dispatching events, import directly from './dispatch' in server-only code.
 */

export * from './types'

// Re-export hook types for consumers
export type {
  HookHandler,
  HookResult,
  HookTarget,
  TestResult,
  ProcessResult,
  EmailTarget,
  EmailConfig,
} from './hook-types'

export type { NotificationTarget, NotificationConfig } from './handlers/notification'
export type { WebhookTarget, WebhookConfig } from './handlers/webhook'

// Export registry functions
export { getHook, registerHook } from './registry'

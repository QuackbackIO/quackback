/**
 * Hook system re-exports for backwards compatibility.
 *
 * The hook system has moved to @/lib/events/.
 * Prefer importing directly from '@/lib/events' in new code.
 */

// Re-export registry functions
export { getHook, registerHook } from '@/lib/events/registry'

// Re-export types
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
} from '@/lib/events/hook-types'

export type { NotificationTarget, NotificationConfig } from '@/lib/events/handlers/notification'
export type { WebhookTarget, WebhookConfig } from '@/lib/events/handlers/webhook'

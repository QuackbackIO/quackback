/**
 * Hook registry.
 *
 * Hooks are triggered when events occur. All hook types register here.
 * The event processor uses getHook() to run hooks.
 */

import type { HookHandler } from './types'

// Import handlers (they export their hook objects, don't self-register)
import { slackHook } from './slack/handler'
import { emailHook } from './email/handler'
import { notificationHook } from './notification/handler'
import { aiHook } from './ai/handler'

// Initialize hooks Map AFTER imports are resolved
const hooks = new Map<string, HookHandler>([
  ['slack', slackHook],
  ['email', emailHook],
  ['notification', notificationHook],
  ['ai', aiHook],
])

/**
 * Get a registered hook by type.
 */
export function getHook(type: string): HookHandler | undefined {
  return hooks.get(type)
}

/**
 * Register a hook handler.
 */
export function registerHook(type: string, handler: HookHandler): void {
  hooks.set(type, handler)
}

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
} from './types'

export type { NotificationTarget, NotificationConfig } from './notification'

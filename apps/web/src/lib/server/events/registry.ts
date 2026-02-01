/**
 * Hook registry.
 *
 * Hooks are triggered when events occur. All hook types register here.
 * The event processor uses getHook() to run hooks.
 */

import type { HookHandler } from './hook-types'

// Import handlers from the handlers directory
import { slackHook } from './handlers/slack'
import { emailHook } from './handlers/email'
import { notificationHook } from './handlers/notification'
import { aiHook } from './handlers/ai'
import { webhookHook } from './handlers/webhook'

// Initialize hooks Map AFTER imports are resolved
const hooks = new Map<string, HookHandler>([
  ['slack', slackHook],
  ['email', emailHook],
  ['notification', notificationHook],
  ['ai', aiHook],
  ['webhook', webhookHook],
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

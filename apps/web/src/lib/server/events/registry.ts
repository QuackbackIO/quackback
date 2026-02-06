/**
 * Hook registry.
 *
 * Hooks are triggered when events occur. All hook types register here.
 * The event processor uses getHook() to run hooks.
 *
 * Integration hooks (Slack, Discord, etc.) are resolved via the integration
 * registry. Built-in hooks (email, notification, ai, webhook) live here.
 */

import type { HookHandler } from './hook-types'
import { getIntegrationHook } from '@/lib/server/integrations'

// Import built-in handlers
import { emailHook } from './handlers/email'
import { notificationHook } from './handlers/notification'
import { aiHook } from './handlers/ai'
import { webhookHook } from './handlers/webhook'

const builtinHooks = new Map<string, HookHandler>([
  ['email', emailHook],
  ['notification', notificationHook],
  ['ai', aiHook],
  ['webhook', webhookHook],
])

/**
 * Get a registered hook by type.
 * Checks built-in hooks first, then falls through to integration hooks.
 */
export function getHook(type: string): HookHandler | undefined {
  return builtinHooks.get(type) ?? getIntegrationHook(type)
}

/**
 * Register a hook handler.
 */
export function registerHook(type: string, handler: HookHandler): void {
  builtinHooks.set(type, handler)
}

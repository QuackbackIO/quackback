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
 * Lazy-loaded hooks resolved via dynamic import to avoid circular dependencies.
 * (feedback-pipeline → db → ... → events → registry)
 */
const lazyHooks: Record<string, () => Promise<HookHandler>> = {
  feedback_pipeline: () =>
    import('./handlers/feedback-pipeline').then((m) => m.feedbackPipelineHook),
  summary: () => import('./handlers/summary').then((m) => m.summaryHook),
  merge_suggestion: () => import('./handlers/merge-suggestion').then((m) => m.mergeSuggestionHook),
}

/**
 * Get a registered hook by type.
 * Checks built-in hooks first, then lazy hooks, then integration hooks.
 */
export async function getHook(type: string): Promise<HookHandler | undefined> {
  const builtin = builtinHooks.get(type)
  if (builtin) return builtin

  const lazyLoader = lazyHooks[type]
  if (lazyLoader) {
    const hook = await lazyLoader()
    builtinHooks.set(type, hook) // cache for next call
    return hook
  }

  return getIntegrationHook(type)
}

/**
 * Register a hook handler.
 */
export function registerHook(type: string, handler: HookHandler): void {
  builtinHooks.set(type, handler)
}

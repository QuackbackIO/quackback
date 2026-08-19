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
import { appWebhookHook } from './handlers/app-webhook'

const builtinHooks = new Map<string, HookHandler>([
  ['email', emailHook],
  ['notification', notificationHook],
  ['ai', aiHook],
  ['webhook', webhookHook],
  ['app_webhook', appWebhookHook],
])

/**
 * Lazy-loaded hooks resolved via dynamic import to avoid circular dependencies.
 */
const lazyHooks: Record<string, () => Promise<HookHandler>> = {
  summary: () => import('./handlers/summary').then((m) => m.summaryHook),
  // IF WO-15: outbound two-way status sync. Enqueued by remote-status-push.resolver.
  remote_status_push: () =>
    import('./handlers/remote-status-push').then((m) => m.remoteStatusPushHook),
  // EVENTING-V2 WO-8e: workflow triggers ride the outbox → relay → this hook.
  workflow: () => import('./handlers/workflow').then((m) => m.workflowHook),
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

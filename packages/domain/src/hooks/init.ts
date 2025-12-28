/**
 * Hook System Initialization
 *
 * Initializes the hook system with core plugins and optional example plugins.
 * Call this during application startup (e.g., in instrumentation.ts or app initialization).
 */

import { pluginManager } from './index'
import { eventBridgePlugin } from './plugins/event-bridge'
// Example plugins (optional - can be activated based on configuration)
import { analyticsPlugin } from './plugins/analytics'
import { contentEnricherPlugin } from './plugins/content-enricher'
import { spamFilterPlugin } from './plugins/spam-filter'

/**
 * Configuration for hook system initialization
 */
export interface HookSystemConfig {
  /** Whether to enable the event bridge plugin (default: true) */
  enableEventBridge?: boolean
  /** Whether to enable analytics tracking (default: false) */
  enableAnalytics?: boolean
  /** Whether to enable content enrichment (default: false) */
  enableContentEnricher?: boolean
  /** Whether to enable spam filtering (default: false) */
  enableSpamFilter?: boolean
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: HookSystemConfig = {
  enableEventBridge: true,
  enableAnalytics: false,
  enableContentEnricher: false,
  enableSpamFilter: false,
}

/**
 * Initialize the hook system with configured plugins
 *
 * @param config - Optional configuration to override defaults
 * @returns Promise that resolves when all plugins are activated
 *
 * @example
 * ```ts
 * // In your app initialization (instrumentation.ts or similar)
 * import { initializeHooks } from '@quackback/domain/hooks/init'
 *
 * await initializeHooks({
 *   enableEventBridge: true,
 *   enableSpamFilter: true,
 * })
 * ```
 */
export async function initializeHooks(config: HookSystemConfig = {}): Promise<void> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }

  console.log('[Hooks] Initializing hook system...')

  // Register all available plugins
  pluginManager.registerPlugin(eventBridgePlugin)
  pluginManager.registerPlugin(analyticsPlugin)
  pluginManager.registerPlugin(contentEnricherPlugin)
  pluginManager.registerPlugin(spamFilterPlugin)

  // Activate plugins based on configuration
  const pluginsToActivate: string[] = []

  if (mergedConfig.enableEventBridge) {
    pluginsToActivate.push(eventBridgePlugin.id)
  }
  if (mergedConfig.enableAnalytics) {
    pluginsToActivate.push(analyticsPlugin.id)
  }
  if (mergedConfig.enableContentEnricher) {
    pluginsToActivate.push(contentEnricherPlugin.id)
  }
  if (mergedConfig.enableSpamFilter) {
    pluginsToActivate.push(spamFilterPlugin.id)
  }

  // Activate all configured plugins
  await pluginManager.activatePlugins(pluginsToActivate)

  const activePlugins = pluginManager.getActivePlugins()
  console.log(
    `[Hooks] Hook system initialized with ${activePlugins.length} active plugins:`,
    activePlugins.map((p) => p.name).join(', ')
  )
}

/**
 * Shutdown the hook system
 *
 * Deactivates all plugins and cleans up resources.
 * Call this during application shutdown for graceful cleanup.
 *
 * @example
 * ```ts
 * // In your shutdown handler
 * await shutdownHooks()
 * ```
 */
export async function shutdownHooks(): Promise<void> {
  console.log('[Hooks] Shutting down hook system...')
  await pluginManager.deactivateAll()
  console.log('[Hooks] Hook system shutdown complete')
}

/**
 * Get current hook system status
 *
 * Useful for debugging or displaying hook status in admin UI
 *
 * @returns Status information about the hook system
 */
export function getHookSystemStatus() {
  const allPlugins = pluginManager.getPlugins()
  const activePlugins = pluginManager.getActivePlugins()

  return {
    totalPlugins: allPlugins.length,
    activePlugins: activePlugins.length,
    plugins: allPlugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      active: pluginManager.isActive(plugin.id),
    })),
  }
}

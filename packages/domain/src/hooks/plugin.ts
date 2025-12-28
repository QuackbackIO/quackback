/**
 * Hook Plugin System
 *
 * Provides an interface for plugins to register hooks with the registry.
 * Plugins can bundle multiple related hooks together.
 */

import type { HookRegistry } from './registry'

/**
 * Plugin interface for hook-based extensions
 *
 * Plugins implement this interface to register their hooks with the system.
 * Each plugin has a unique ID and can register multiple hooks across different entities.
 *
 * @example
 * ```ts
 * export class SpamFilterPlugin implements HookPlugin {
 *   readonly id = 'spam-filter'
 *   readonly name = 'Spam Detection'
 *
 *   register(registry: HookRegistry): void {
 *     registry.addValidation(
 *       HOOKS.POST_VALIDATE_CREATE,
 *       async (input, ctx) => {
 *         const isSpam = await detectSpam(input.content)
 *         if (isSpam) return err(PostError.validationError('Spam detected'))
 *         return ok(input)
 *       },
 *       PRIORITY.HIGH,
 *       `${this.id}:post-spam-check`
 *     )
 *   }
 *
 *   unregister(registry: HookRegistry): void {
 *     registry.removeValidation(HOOKS.POST_VALIDATE_CREATE, `${this.id}:post-spam-check`)
 *   }
 * }
 * ```
 */
export interface HookPlugin {
  /** Unique identifier for this plugin */
  readonly id: string

  /** Human-readable name */
  readonly name: string

  /** Optional description */
  readonly description?: string

  /** Optional version */
  readonly version?: string

  /**
   * Register hooks with the registry
   *
   * This method is called when the plugin is activated.
   * Plugins should register all their hooks here.
   *
   * @param registry - The global hook registry
   */
  register(registry: HookRegistry): void | Promise<void>

  /**
   * Unregister hooks from the registry
   *
   * This method is called when the plugin is deactivated.
   * Plugins should remove all their hooks here.
   *
   * @param registry - The global hook registry
   */
  unregister(registry: HookRegistry): void | Promise<void>
}

/**
 * Plugin manager for activating/deactivating plugins
 */
export class PluginManager {
  private plugins = new Map<string, HookPlugin>()
  private activePlugins = new Set<string>()

  constructor(private registry: HookRegistry) {}

  /**
   * Register a plugin (but don't activate it yet)
   *
   * @param plugin - Plugin to register
   */
  registerPlugin(plugin: HookPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin ${plugin.id} is already registered`)
    }
    this.plugins.set(plugin.id, plugin)
  }

  /**
   * Activate a plugin
   *
   * Calls the plugin's register() method to add hooks to the registry.
   *
   * @param pluginId - ID of the plugin to activate
   */
  async activatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`)
    }

    if (this.activePlugins.has(pluginId)) {
      return // Already active
    }

    await plugin.register(this.registry)
    this.activePlugins.add(pluginId)
  }

  /**
   * Deactivate a plugin
   *
   * Calls the plugin's unregister() method to remove hooks from the registry.
   *
   * @param pluginId - ID of the plugin to deactivate
   */
  async deactivatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`)
    }

    if (!this.activePlugins.has(pluginId)) {
      return // Already inactive
    }

    await plugin.unregister(this.registry)
    this.activePlugins.delete(pluginId)
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): HookPlugin[] {
    return Array.from(this.plugins.values())
  }

  /**
   * Get active plugins
   */
  getActivePlugins(): HookPlugin[] {
    return Array.from(this.plugins.values()).filter((p) => this.activePlugins.has(p.id))
  }

  /**
   * Check if a plugin is active
   */
  isActive(pluginId: string): boolean {
    return this.activePlugins.has(pluginId)
  }

  /**
   * Activate multiple plugins at once
   */
  async activatePlugins(pluginIds: string[]): Promise<void> {
    for (const id of pluginIds) {
      await this.activatePlugin(id)
    }
  }

  /**
   * Deactivate all plugins
   */
  async deactivateAll(): Promise<void> {
    const activeIds = Array.from(this.activePlugins)
    for (const id of activeIds) {
      await this.deactivatePlugin(id)
    }
  }
}

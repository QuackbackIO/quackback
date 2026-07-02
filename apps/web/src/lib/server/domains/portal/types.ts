import { z } from 'zod'

/**
 * All available portal tabs that can be configured
 */
export type PortalTab =
  | 'feedback'
  | 'roadmap'
  | 'changelog'
  | 'myTickets'
  | 'helpCenter'
  | 'support'

/**
 * Portal tab visibility configuration
 * Each field represents whether that tab is visible to the user
 */
export interface PortalTabConfig {
  feedback?: boolean
  roadmap?: boolean
  changelog?: boolean
  myTickets?: boolean
  helpCenter?: boolean
  support?: boolean
}

/**
 * Zod schema for parsing and validating portal tab config from JSON
 */
export const portalTabConfigSchema = z.object({
  feedback: z.boolean().optional(),
  roadmap: z.boolean().optional(),
  changelog: z.boolean().optional(),
  myTickets: z.boolean().optional(),
  helpCenter: z.boolean().optional(),
  support: z.boolean().optional(),
})

/**
 * Parse portal tab config from JSON string (lenient)
 * Returns normalized config with explicit booleans or defaults
 */
export function parsePortalTabConfig(json: string | null | undefined): PortalTabConfig {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    return portalTabConfigSchema.parse(parsed)
  } catch {
    return {}
  }
}

/**
 * Serialize portal tab config to JSON string
 */
export function serializePortalTabConfig(config: PortalTabConfig): string {
  return JSON.stringify(config)
}

/**
 * Get the default portal tab config (all tabs enabled)
 */
export function getDefaultPortalTabConfig(): PortalTabConfig {
  return {
    feedback: true,
    roadmap: true,
    changelog: true,
    myTickets: true,
    helpCenter: true,
    support: true,
  }
}

/**
 * Merge multiple tab configs using union logic
 * If any config enables a tab, it's enabled in the result
 * @param configs - Array of configs to merge
 * @returns Merged config with union of enabled tabs
 */
export function mergeTabConfigs(...configs: PortalTabConfig[]): PortalTabConfig {
  const result: PortalTabConfig = {}
  const tabs: PortalTab[] = [
    'feedback',
    'roadmap',
    'changelog',
    'myTickets',
    'helpCenter',
    'support',
  ]

  for (const tab of tabs) {
    // If any config enables this tab (or doesn't mention it = default true), enable it
    const enabled = configs.some((config) => config[tab] !== false)
    result[tab] = enabled
  }

  return result
}

/**
 * Intersect multiple tab configs
 * Only tabs enabled in ALL configs are enabled in the result
 * @param configs - Array of configs to intersect
 * @returns Intersected config with only common enabled tabs
 */
export function intersectTabConfigs(...configs: PortalTabConfig[]): PortalTabConfig {
  if (configs.length === 0) return getDefaultPortalTabConfig()

  const result: PortalTabConfig = {}
  const tabs: PortalTab[] = [
    'feedback',
    'roadmap',
    'changelog',
    'myTickets',
    'helpCenter',
    'support',
  ]

  for (const tab of tabs) {
    // Tab is enabled only if enabled in all configs
    const enabled = configs.every((config) => config[tab] !== false)
    result[tab] = enabled
  }

  return result
}

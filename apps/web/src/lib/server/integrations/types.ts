import type { HookHandler } from '../events/hook-types'
import type { MemberId } from '@quackback/ids'

export interface IntegrationOAuthConfig {
  /** State type discriminator (e.g. 'slack_oauth') */
  stateType: string
  /** Provider's error query param name (default: 'error') */
  errorParam?: string
  /** Build the external authorization URL */
  buildAuthUrl(state: string, redirectUri: string): string
  /** Exchange auth code for tokens */
  exchangeCode(
    code: string,
    redirectUri: string
  ): Promise<{
    accessToken: string
    externalWorkspaceId: string
    externalWorkspaceName: string
    /** Refresh token for providers with short-lived access tokens */
    refreshToken?: string
    /** Token lifetime in seconds (omit for non-expiring tokens like Slack) */
    expiresIn?: number
  }>
}

/**
 * Purpose-based integration categories.
 * Grouped by what the user is trying to do, not by tool type.
 */
export const INTEGRATION_CATEGORIES = {
  notifications: {
    label: 'Notifications',
    description: 'Get notified when things happen',
  },
  issue_tracking: {
    label: 'Issue Tracking',
    description: 'Push feedback into your workflow',
  },
  support_crm: {
    label: 'Support & CRM',
    description: 'Enrich feedback with customer data',
  },
  automation: {
    label: 'Automation',
    description: 'Connect to anything',
  },
} as const

export type IntegrationCategory = keyof typeof INTEGRATION_CATEGORIES

/**
 * A specific thing an integration can do.
 * Shown as bullet points on the integration detail page.
 */
export interface IntegrationCapability {
  /** User-facing label, e.g. "Send channel notifications" */
  label: string
  /** Short description, e.g. "Posts a message to a Slack channel when events occur" */
  description: string
}

export interface IntegrationCatalogEntry {
  id: string
  name: string
  description: string
  category: IntegrationCategory
  capabilities: IntegrationCapability[]
  iconBg: string
  settingsPath: string
  available: boolean
}

export interface IntegrationDefinition {
  id: string
  catalog: IntegrationCatalogEntry
  oauth?: IntegrationOAuthConfig
  hook?: HookHandler
  requiredEnvVars?: string[]
  saveConnection?(params: {
    memberId: MemberId
    accessToken: string
    externalWorkspaceId: string
    externalWorkspaceName: string
    refreshToken?: string
    expiresIn?: number
  }): Promise<void>
  /** Called before an integration is deleted. Receives decrypted secrets to revoke tokens or clean up. */
  onDisconnect?(secrets: Record<string, unknown>): Promise<void>
}

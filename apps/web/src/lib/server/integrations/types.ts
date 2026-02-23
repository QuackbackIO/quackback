import type { HookHandler } from '../events/hook-types'
import type { InboundWebhookHandler } from './inbound-types'
import type { UserSyncHandler } from './user-sync-types'

/**
 * A field collected from the user before starting the OAuth flow.
 * Used for providers that need user-specific info in their OAuth URLs (e.g. Zendesk subdomain).
 */
export interface PreAuthField {
  name: string
  label: string
  placeholder?: string
  /** Regex pattern for validation (e.g. '^[a-z0-9-]+$') */
  pattern?: string
  /** Error message shown when pattern validation fails */
  patternError?: string
  required?: boolean
}

/**
 * A platform-level credential field for an integration.
 * These are OAuth app credentials (client ID, secret, bot tokens) that
 * enable the integration, configured by admins through the UI.
 */
export interface PlatformCredentialField {
  /** Property key in the credentials object (e.g. 'clientId', 'clientSecret') */
  key: string
  /** User-facing label (e.g. 'Client ID') */
  label: string
  /** Placeholder text for the input */
  placeholder?: string
  /** true → password input, masked on display */
  sensitive: boolean
  /** Help text shown below the field */
  helpText?: string
  /** Link to provider docs for setting up credentials */
  helpUrl?: string
}

export interface IntegrationOAuthConfig {
  /** State type discriminator (e.g. 'slack_oauth') */
  stateType: string
  /** Provider's error query param name (default: 'error') */
  errorParam?: string
  /** Fields collected before OAuth (e.g. subdomain for Zendesk). Rendered by the settings UI. */
  preAuthFields?: PreAuthField[]
  /** Build the external authorization URL */
  buildAuthUrl(
    state: string,
    redirectUri: string,
    fields?: Record<string, string>,
    credentials?: Record<string, string>
  ): string
  /** Exchange auth code for tokens */
  exchangeCode(
    code: string,
    redirectUri: string,
    fields?: Record<string, string>,
    credentials?: Record<string, string>
  ): Promise<{
    accessToken: string
    /** Refresh token for providers with short-lived access tokens */
    refreshToken?: string
    /** Token lifetime in seconds (omit for non-expiring tokens like Slack) */
    expiresIn?: number
    /** Integration-specific config merged into the config column (workspace info, site URLs, etc.) */
    config?: Record<string, unknown>
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
  user_data: {
    label: 'User Data',
    description: 'Sync user attributes and segment membership',
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
  /** true if the integration requires platform credentials to be configured */
  configurable: boolean
  /** Field definitions for platform credentials. Present in catalog API response, empty array if none needed. */
  platformCredentialFields?: PlatformCredentialField[]
  /** Link to the setup guide on the docs site */
  docsUrl?: string
}

export interface IntegrationDefinition {
  id: string
  catalog: IntegrationCatalogEntry
  oauth?: IntegrationOAuthConfig
  hook?: HookHandler
  /** Inbound webhook handler for receiving status changes from the external platform */
  inbound?: InboundWebhookHandler
  /**
   * User data sync handler for CDP-style integrations.
   * Supports inbound identify events (CDP → user.metadata) and outbound
   * segment membership sync (evaluation → external platform).
   */
  userSync?: UserSyncHandler
  /** Platform-level credential fields required to enable this integration. Use `[]` if none needed. */
  platformCredentials: PlatformCredentialField[]
  /** Called before an integration is deleted. Receives decrypted secrets, config, and platform credentials to revoke tokens or clean up. */
  onDisconnect?(
    secrets: Record<string, unknown>,
    config: Record<string, unknown>,
    credentials?: Record<string, string>
  ): Promise<void>
}

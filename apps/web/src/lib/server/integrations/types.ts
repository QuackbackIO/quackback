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

export interface IntegrationCatalogEntry {
  id: string
  name: string
  description: string
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

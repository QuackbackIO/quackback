import type { HookHandler } from '../events/hook-types'
import type { InboundWebhookHandler } from './inbound-types'
import type { FeedbackConnector } from './feedback-source-types'
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
  /** true → the value is a URL the server will fetch; validated against the
   *  SSRF guard at save so an admin can't point it at internal infrastructure. */
  url?: boolean
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
  /**
   * Capability badges. DERIVED from the definition's slots at
   * getIntegrationCatalog() so the catalog cannot drift from what a
   * provider implements (IF WO-4). Hand-written entries are honored ONLY
   * as a fallback for providers with no capability slots yet (the
   * enrichment-only providers, until the context capability lands).
   */
  capabilities?: IntegrationCapability[]
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

/** The stored fields for a ticket ↔ external issue link, produced by
 *  `IssueTrackerCapability.parseRef`. */
export interface ParsedIssueRef {
  /**
   * MUST be in the same namespace the provider's inbound `parseStatusChange`
   * emits as `externalId` (GitHub: issue number; Jira: issue key; Azure
   * DevOps: work item id) — the inbound handler reverse-looks-up links by
   * this value, so a mismatched namespace silently breaks status sync.
   */
  externalId: string
  /** Human-readable reference shown in the UI (e.g. "acme/app#412", "PROJ-42"). */
  externalDisplayId: string
  externalUrl: string | null
}

/**
 * Issue-tracker capabilities beyond the event-bus create hook. Optional per
 * provider; surfaces that offer manual linking / creation gate on the
 * specific member being present, never on the provider id.
 */
export interface IssueTrackerCapability {
  /**
   * Parse a user-pasted issue reference (full URL or provider shorthand) into
   * the stored link fields. Returns null when the input is not recognizably
   * this provider's reference shape; throws ValidationError for a parseable
   * ref that violates the connected config (e.g. a foreign repository, when
   * the integration pins one).
   */
  parseRef?(input: string, config: Record<string, unknown>): ParsedIssueRef | null
  /**
   * Create an issue/work item on the connected channel. Abstracts the CALL,
   * not the body format: `bodyMarkdown` is GitHub-flavored markdown and each
   * provider down-converts to its native format (Markdown passthrough for
   * GitHub/Linear, plain-paragraph ADF for Jira, escaped HTML for Azure
   * DevOps). `auth` is the merged integration config + decrypted secrets —
   * the same bag the event-bus hook receives (accessToken/PAT, channelId,
   * cloudId, organizationName, …). Throws an Error with a user-facing
   * message and optional `{ retryable?: boolean }` on failure.
   */
  create?(args: {
    auth: Record<string, unknown>
    title: string
    bodyMarkdown: string
  }): Promise<ParsedIssueRef>
  /**
   * Build the `auth` bag for `create` from the raw integration row, for
   * providers whose credentials need more than a config+secrets merge —
   * Jira's expiring OAuth token, refreshed and persisted before use. Absent =
   * the caller merges `{ ...config, ...decryptSecrets(secrets) }`.
   */
  prepareAuth?(integration: {
    id: import('@quackback/ids').IntegrationId
    secrets: unknown
    config: unknown
  }): Promise<Record<string, unknown>>
}

/** One selectable external status/state, as shown in the status-mapping UI. */
export interface ExternalStatusItem {
  id: string
  name: string
}

/** A single labelled fact on a customer-context card. */
export interface EnrichmentField {
  label: string
  value: string
}

/**
 * Normalized customer context (IF WO-9), rendered by the generic enrichment
 * panel on a post/user. Providers map their own contact/company shape onto
 * this; the panel never knows the provider's native format.
 */
export interface EnrichmentCard {
  /** Integration id that produced this card (for the icon + label). */
  provider: string
  name?: string
  company?: string
  /** Deep link to the contact in the provider's own tool. */
  url?: string
  fields: EnrichmentField[]
}

export interface IntegrationDefinition {
  id: string
  catalog: IntegrationCatalogEntry
  oauth?: IntegrationOAuthConfig
  hook?: HookHandler
  /** Inbound webhook handler for receiving status changes from the external platform */
  inbound?: InboundWebhookHandler
  /** Issue-tracker capabilities (manual ref parsing; issue creation in a later phase). */
  issues?: IssueTrackerCapability
  /**
   * User data sync handler for CDP-style integrations.
   * Supports inbound identify events (CDP → user.metadata) and outbound
   * segment membership sync (evaluation → external platform).
   */
  userSync?: UserSyncHandler
  /**
   * Close/archive the linked external item on cascading post delete. Never
   * throws — failures are warnings, not blockers (see archive.ts semantics:
   * 404 means already-gone and counts as success).
   */
  archive?: (ctx: import('./archive').ArchiveContext) => Promise<import('./archive').ArchiveResult>
  /**
   * How the inbound status-sync webhook gets set up with the provider.
   * `'manual'` = the admin configures the webhook by hand on the external
   * platform (the UI shows the callback URL); an object = the framework
   * auto-registers/deregisters via the provider API when status sync is
   * toggled. Expected alongside `inbound` — pinned by
   * registry-capability-coverage so provider #12 can't silently no-op.
   */
  /**
   * Refresh an expiring OAuth access token — a thin wrapper over the
   * provider's token endpoint. The framework's getValidAccessToken
   * (token-refresh.ts) owns expiry checking, by-id persistence, and
   * resolver-cache invalidation; providers never persist tokens themselves.
   */
  refreshToken?: (
    refreshToken: string,
    credentials?: Record<string, string>
  ) => Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }>
  /**
   * On-demand customer context for the enrichment panel (IF WO-9). Looks the
   * person up by email in the provider's tool and returns a normalized card,
   * or null when there's no match. Fetched lazily when an agent opens the
   * context section — never eagerly per post.
   */
  context?: (params: {
    accessToken: string
    config: Record<string, unknown>
    email: string
  }) => Promise<import('./types').EnrichmentCard | null>
  /**
   * List the provider's statuses/states for the status-mapping UI. Any
   * scoping id (team, list, board, cloud) is read from `config` — it is
   * persisted at connect/config time, never passed per call. Returned ids
   * MUST use the same vocabulary the provider's inbound handler reports as
   * `externalStatus`, since mappings are keyed by that name. Expected
   * alongside `inbound` (pinned by registry-capability-coverage).
   */
  listExternalStatuses?: (params: {
    accessToken: string
    config: Record<string, unknown>
  }) => Promise<ExternalStatusItem[]>
  webhookRegistration?:
    | 'manual'
    | {
        register(params: {
          accessToken: string
          config: Record<string, unknown>
          callbackUrl: string
          secret: string
        }): Promise<{ externalWebhookId?: string }>
        unregister(params: {
          accessToken: string
          config: Record<string, unknown>
          externalWebhookId: string
        }): Promise<void>
      }
  /** Platform-level credential fields required to enable this integration. Use `[]` if none needed. */
  platformCredentials: PlatformCredentialField[]
  /** Feedback source connector for ingesting feedback from this platform */
  feedbackSource?: FeedbackConnector
  /** Called after an integration is saved (connect or reconnect). Receives the integration ID to provision dependent resources. */
  onConnect?(integrationId: import('@quackback/ids').IntegrationId): Promise<void>
  /** Called before an integration is deleted. Receives decrypted secrets, config, and platform credentials to revoke tokens or clean up. */
  onDisconnect?(
    secrets: Record<string, unknown>,
    config: Record<string, unknown>,
    credentials?: Record<string, string>
  ): Promise<void>
}

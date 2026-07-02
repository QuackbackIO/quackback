import type { TicketStatusCategory } from '@/lib/server/db'

/** Sync direction for a GitHub integration connection */
export type GitHubSyncDirection = 'outbound' | 'inbound' | 'bidirectional'

/**
 * Maps ticket status categories to GitHub issue states.
 * GitHub only has two states: 'open' and 'closed'.
 * Intermediate categories (pending, on_hold) stay as 'open' with optional labels.
 */
export interface GitHubStatusMapping {
  /** GitHub state when ticket enters this category */
  state: 'open' | 'closed'
  /** Optional label to add to the issue for this category */
  label?: string
}

/** Default status mappings: ticket category → GitHub issue state */
export const DEFAULT_GITHUB_STATUS_MAPPINGS: Record<TicketStatusCategory, GitHubStatusMapping> = {
  open: { state: 'open' },
  pending: { state: 'open', label: 'waiting-on-customer' },
  on_hold: { state: 'open', label: 'on-hold' },
  solved: { state: 'closed' },
  closed: { state: 'closed' },
}

/**
 * Per-repo GitHub integration config (stored in integrations.config JSONB).
 * Extends the base IntegrationConfig with GitHub-specific fields.
 */
export interface GitHubIntegrationConfig {
  /** Repository in "owner/repo" format */
  channelId: string
  /** GitHub username of the user who connected */
  username?: string
  /** Direction of sync: outbound (ticket→issue), inbound (issue→ticket), or both */
  syncDirection: GitHubSyncDirection
  /** Whether to sync assignees bidirectionally */
  assigneeSync: boolean
  /** Maps ticket status categories to GitHub issue states + labels */
  statusMappings?: Partial<Record<TicketStatusCategory, GitHubStatusMapping>>
  /** GitHub webhook ID (set when status sync is enabled) */
  externalWebhookId?: string
  /** HMAC secret for webhook signature verification */
  webhookSecret?: string
  /** Whether the inbound GitHub webhook has been configured */
  statusSyncEnabled?: boolean
  /** Version marker for the GitHub provider webhook event subscription shape */
  githubWebhookEventsVersion?: number
  /** Whether to auto-create tickets from new GitHub issues */
  createTicketsFromIssues?: boolean
  /** Default inbox for tickets created from inbound GitHub issues */
  defaultInboxId?: string | null
}

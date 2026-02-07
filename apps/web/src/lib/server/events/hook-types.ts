/**
 * Hook system types.
 *
 * Hooks are triggered when events occur. Each hook type (Slack, Email, Discord,
 * Webhook, Linear, etc.) implements the same interface. The orchestration layer
 * decides WHICH hooks to trigger, handlers decide HOW to deliver.
 */

import type { EventData } from './types'

/**
 * Result of running a hook.
 */
export interface HookResult {
  success: boolean
  /** External ID (Slack ts, Discord message id, email id, Linear issue id) */
  externalId?: string
  /** External URL (Linear issue URL, etc.) */
  externalUrl?: string
  /** Error message if failed */
  error?: string
  /** Whether this error is retryable (network issues, rate limits) */
  shouldRetry?: boolean
}

/**
 * Result of testing a hook connection.
 */
export interface TestResult {
  ok: boolean
  error?: string
}

/**
 * Hook handler interface.
 *
 * Each hook type (Slack, Discord, Email, Webhook, etc.) implements this interface.
 * The `run` method is called once per target.
 *
 * @example
 * ```typescript
 * export const slackHook: HookHandler = {
 *   async run(event, target, config) {
 *     const { channelId } = target
 *     const { accessToken } = config
 *     // ... send to Slack
 *     return { success: true, externalId: result.ts }
 *   }
 * }
 * ```
 */
export interface HookHandler {
  /**
   * Run the hook for a single target.
   *
   * @param event - The event that triggered the hook
   * @param target - Where to send (channel, email, webhook URL, etc.)
   * @param config - Hook-specific configuration (tokens, settings, etc.)
   */
  run(event: EventData, target: unknown, config: Record<string, unknown>): Promise<HookResult>

  /**
   * Test the connection to the external service.
   * Optional - only needed for OAuth integrations.
   */
  testConnection?(config: Record<string, unknown>): Promise<TestResult>
}

/**
 * A resolved hook target from the database.
 * Returned by getHookTargets() in the orchestration layer.
 */
export interface HookTarget {
  /** Hook type: 'slack', 'discord', 'email', 'webhook', 'linear' */
  type: string
  /** Hook-specific target (channel, email address, webhook URL, etc.) */
  target: unknown
  /** Hook-specific config (access token, workspace name, etc.) */
  config: Record<string, unknown>
}

// ============================================================================
// Hook-specific target/config types
// ============================================================================

/**
 * Email hook target and config.
 */
export interface EmailTarget {
  email: string
  name?: string
  unsubscribeUrl: string
}

export interface EmailConfig {
  workspaceName: string
  postUrl: string
  postTitle: string
  previousStatus?: string
  newStatus?: string
  commenterName?: string
  commentPreview?: string
  isTeamMember?: boolean
}

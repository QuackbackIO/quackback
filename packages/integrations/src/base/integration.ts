/**
 * Base class for all integrations.
 * Provides common utilities and defines the interface for integration processors.
 */
import type { OrgId } from '@quackback/ids'
import type { Redis } from 'ioredis'

export type DomainEventType =
  | 'post.created'
  | 'post.updated'
  | 'post.status_changed'
  | 'post.deleted'
  | 'comment.created'
  | 'comment.deleted'
  | 'vote.created'
  | 'vote.deleted'
  | 'changelog.published'

export interface DomainEvent<T = unknown> {
  id: string
  type: DomainEventType
  organizationId: OrgId
  timestamp: string
  actor: { type: 'user' | 'system'; userId?: string; email?: string; service?: string }
  data: T
}

export interface IntegrationContext {
  organizationId: OrgId
  integrationId: string
  accessToken: string
  config: Record<string, unknown>
  /** Redis client (optional - not available in Cloudflare Workers) */
  redis?: Redis
}

export interface ProcessResult {
  success: boolean
  externalEntityId?: string
  externalEntityUrl?: string
  error?: string
  shouldRetry?: boolean
}

export abstract class BaseIntegration {
  abstract readonly type: string
  abstract readonly displayName: string
  abstract readonly supportedEvents: DomainEventType[]

  /**
   * Processes a domain event and performs the integration action.
   */
  abstract processEvent(
    event: DomainEvent,
    actionType: string,
    actionConfig: Record<string, unknown>,
    ctx: IntegrationContext
  ): Promise<ProcessResult>

  /**
   * Tests the connection to the external service.
   */
  abstract testConnection(ctx: IntegrationContext): Promise<{ ok: boolean; error?: string }>

  /**
   * Truncates text to a maximum length with ellipsis.
   */
  protected truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength - 3) + '...'
  }

  /**
   * Determines if an error is retryable (temporary failures).
   */
  protected isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const msg = error.message.toLowerCase()
    return (
      msg.includes('timeout') ||
      msg.includes('rate') ||
      msg.includes('503') ||
      msg.includes('502') ||
      msg.includes('temporarily') ||
      msg.includes('econnreset') ||
      msg.includes('enotfound')
    )
  }

  /**
   * Strips HTML tags from text (useful for Slack/Discord formatting).
   */
  protected stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '')
  }

  /**
   * Escapes special characters for Slack mrkdwn format.
   */
  protected escapeSlackMrkdwn(text: string): string {
    return text.replace(/[&<>]/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;'
        case '<':
          return '&lt;'
        case '>':
          return '&gt;'
        default:
          return char
      }
    })
  }
}

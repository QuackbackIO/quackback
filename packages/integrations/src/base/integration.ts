/**
 * Base class for all integrations.
 * Provides common utilities and defines the interface for integration processors.
 */

export type DomainEventType =
  | 'post.created'
  | 'post.updated'
  | 'post.status_changed'
  | 'post.deleted'
  | 'comment.created'
  | 'comment.deleted'
  | 'vote.created'
  | 'vote.deleted'

export interface DomainEvent<T = unknown> {
  id: string
  type: DomainEventType
  timestamp: string
  actor: { type: 'user' | 'system'; userId?: string; email?: string; service?: string }
  data: T
}

export interface IntegrationContext {
  integrationId: string
  accessToken: string
  config: Record<string, unknown>
}

/**
 * Event payload types for integration processing
 */
export interface PostCreatedPayload {
  post: {
    id: string
    title: string
    content: string
    boardId: string
    boardSlug: string
    authorEmail?: string
    voteCount: number
  }
}

export interface PostStatusChangedPayload {
  post: {
    id: string
    title: string
    boardSlug: string
  }
  previousStatus: string
  newStatus: string
}

export interface CommentCreatedPayload {
  comment: {
    id: string
    content: string
    authorEmail?: string
  }
  post: {
    id: string
    title: string
  }
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

  /**
   * Determines if an error is retryable (network errors, rate limits, temporary failures).
   */
  protected isRetryableError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      // Check for HTTP status codes that indicate retryable errors
      if ('status' in error) {
        const status = (error as { status?: number }).status
        // 429 (rate limit), 500-599 (server errors)
        return status === 429 || (status !== undefined && status >= 500 && status < 600)
      }
      // Check for network errors
      if ('code' in error) {
        const code = (error as { code?: string }).code
        return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND'
      }
    }
    return false
  }
}

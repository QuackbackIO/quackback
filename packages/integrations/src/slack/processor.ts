/**
 * Slack integration processor.
 * Sends notifications to Slack channels when domain events occur.
 */
import { WebClient } from '@slack/web-api'
import { db, workspaceDomain, eq, and } from '@quackback/db'
import {
  BaseIntegration,
  type DomainEvent,
  type DomainEventType,
  type IntegrationContext,
  type ProcessResult,
} from '../base'

interface PostData {
  id: string
  title: string
  content: string
  boardId?: string
  boardSlug?: string
  authorEmail?: string
  voteCount?: number
}

interface PostCreatedEventData {
  post: PostData
}

interface StatusChangeData {
  post: { id: string; title: string; boardSlug: string }
  previousStatus: string
  newStatus: string
}

interface CommentData {
  comment: { id: string; content: string; authorEmail?: string }
  post: { id: string; title: string }
}

interface ChangelogData {
  changelog: { id: string; title: string; slug: string; content: string }
}

export class SlackIntegration extends BaseIntegration {
  readonly type = 'slack'
  readonly displayName = 'Slack'
  readonly supportedEvents: DomainEventType[] = [
    'post.created',
    'post.status_changed',
    'comment.created',
    'changelog.published',
  ]

  async processEvent(
    event: DomainEvent,
    actionType: string,
    actionConfig: Record<string, unknown>,
    ctx: IntegrationContext
  ): Promise<ProcessResult> {
    const client = new WebClient(ctx.accessToken)
    // Support both camelCase and snake_case config keys
    const channelId = (actionConfig.channel_id ||
      actionConfig.channelId ||
      ctx.config.channelId ||
      ctx.config.default_channel_id) as string

    if (!channelId) {
      return { success: false, error: 'No channel configured' }
    }

    try {
      const message = await this.buildMessage(event)

      const result = await client.chat.postMessage({
        channel: channelId,
        ...message,
      })

      return {
        success: result.ok === true,
        externalEntityId: result.ts,
        error: result.error,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        shouldRetry: this.isRetryableError(error),
      }
    }
  }

  private async buildMessage(event: DomainEvent): Promise<{ text: string; blocks?: unknown[] }> {
    // Look up the primary workspace domain for this organization
    const tenantUrl = await this.getTenantUrl(event.organizationId)

    switch (event.type) {
      case 'post.created': {
        const { post } = event.data as PostCreatedEventData
        const postUrl = `${tenantUrl}/b/${post.boardSlug}/posts/${post.id}`
        const content = this.truncate(this.stripHtml(post.content), 280)

        return {
          text: `New feedback: ${post.title}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `📬 *New Feedback*\n\n*<${postUrl}|${this.escapeSlackMrkdwn(post.title)}>*`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: this.escapeSlackMrkdwn(content),
              },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `📋 ${post.boardSlug}  •  👤 ${post.authorEmail || 'Anonymous'}`,
                },
              ],
            },
          ],
        }
      }

      case 'post.status_changed': {
        const { post, previousStatus, newStatus } = event.data as StatusChangeData
        const postUrl = `${tenantUrl}/b/${post.boardSlug}/posts/${post.id}`
        const emoji = this.getStatusEmoji(newStatus)

        return {
          text: `Status updated: ${post.title}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${emoji} *Status Updated*\n\n*<${postUrl}|${this.escapeSlackMrkdwn(post.title)}>*`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${this.capitalizeStatus(previousStatus)} → *${this.capitalizeStatus(newStatus)}*`,
              },
            },
          ],
        }
      }

      case 'comment.created': {
        const { comment, post } = event.data as CommentData
        // Note: comment events don't have boardSlug yet, use generic URL
        const postUrl = `${tenantUrl}/posts/${post.id}`
        const content = this.truncate(this.stripHtml(comment.content), 200)

        return {
          text: `New comment on: ${post.title}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `💬 *New Comment*\n\nOn *<${postUrl}|${this.escapeSlackMrkdwn(post.title)}>*`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `> ${this.escapeSlackMrkdwn(content)}`,
              },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `👤 ${comment.authorEmail || 'Anonymous'}`,
                },
              ],
            },
          ],
        }
      }

      case 'changelog.published': {
        const { changelog } = event.data as ChangelogData
        const changelogUrl = `${tenantUrl}/changelog/${changelog.slug}`
        const content = this.truncate(this.stripHtml(changelog.content), 300)

        return {
          text: `New changelog: ${changelog.title}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `📢 *New Update Published*\n\n*<${changelogUrl}|${this.escapeSlackMrkdwn(changelog.title)}>*`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: this.escapeSlackMrkdwn(content),
              },
            },
          ],
        }
      }

      default:
        return { text: `Event: ${event.type}` }
    }
  }

  private getStatusEmoji(status: string): string {
    const map: Record<string, string> = {
      open: '📥',
      under_review: '👀',
      planned: '📅',
      in_progress: '🚧',
      complete: '✅',
      closed: '🔒',
    }
    return map[status.toLowerCase().replace(/\s+/g, '_')] || '📌'
  }

  private capitalizeStatus(status: string): string {
    return status
      .split(/[_\s]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  }

  /**
   * Look up the primary workspace domain for an organization.
   * Returns the full URL including protocol.
   */
  private async getTenantUrl(organizationId: string): Promise<string> {
    // Look up primary workspace domain
    const domain = await db.query.workspaceDomain.findFirst({
      where: and(
        eq(workspaceDomain.organizationId, organizationId),
        eq(workspaceDomain.isPrimary, true)
      ),
    })

    if (domain) {
      const isLocalhost = domain.domain.includes('localhost')
      const protocol = isLocalhost ? 'http' : 'https'
      return `${protocol}://${domain.domain}`
    }

    // Fallback: use APP_DOMAIN with org slug (shouldn't happen in practice)
    const appDomain = process.env.APP_DOMAIN || 'localhost:3000'
    const isLocalhost = appDomain.includes('localhost')
    const protocol = isLocalhost ? 'http' : 'https'
    return `${protocol}://${appDomain}`
  }

  async testConnection(ctx: IntegrationContext): Promise<{ ok: boolean; error?: string }> {
    try {
      const client = new WebClient(ctx.accessToken)
      const result = await client.auth.test()
      return { ok: result.ok === true, error: result.error }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  }
}

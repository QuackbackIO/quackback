/**
 * Slack integration processor.
 * Sends notifications to Slack channels when domain events occur.
 */
import { WebClient } from '@slack/web-api'
import {
  BaseIntegration,
  type DomainEvent,
  type DomainEventType,
  type IntegrationContext,
  type ProcessResult,
  type PostCreatedPayload,
  type PostStatusChangedPayload,
  type CommentCreatedPayload,
} from '../base'

export class SlackIntegration extends BaseIntegration {
  readonly type = 'slack'
  readonly displayName = 'Slack'
  readonly supportedEvents: DomainEventType[] = [
    'post.created',
    'post.status_changed',
    'comment.created',
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
      const message = this.buildMessage(event)

      const result = await this.postMessageWithAutoJoin(client, channelId, message)

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

  /**
   * Posts a message to a channel, automatically joining public channels if needed.
   * Private channels (starting with 'G') require manual invitation.
   */
  private async postMessageWithAutoJoin(
    client: WebClient,
    channelId: string,
    message: { text: string; blocks?: unknown[] }
  ): Promise<{ ok?: boolean; ts?: string; error?: string }> {
    try {
      return await client.chat.postMessage({
        channel: channelId,
        unfurl_links: false,
        unfurl_media: false,
        ...message,
      })
    } catch (error) {
      const errorCode = this.getSlackErrorCode(error)

      // If not in channel, try to join (only works for public channels)
      if (errorCode === 'not_in_channel' || errorCode === 'channel_not_found') {
        // Private channels start with 'G', public with 'C'
        const isPrivateChannel = channelId.startsWith('G')

        if (isPrivateChannel) {
          throw new Error(
            'Bot is not in this private channel. Please invite the bot to the channel first.'
          )
        }

        // Attempt to join the public channel
        const joinResult = await client.conversations.join({ channel: channelId })

        if (!joinResult.ok) {
          throw new Error(`Failed to join channel: ${joinResult.error}`)
        }

        // Retry posting after joining
        return await client.chat.postMessage({
          channel: channelId,
          unfurl_links: false,
          unfurl_media: false,
          ...message,
        })
      }

      throw error
    }
  }

  /**
   * Extracts the Slack error code from various error formats.
   */
  private getSlackErrorCode(error: unknown): string | undefined {
    if (error && typeof error === 'object') {
      // @slack/web-api error format
      if ('data' in error && typeof (error as { data?: { error?: string } }).data === 'object') {
        return (error as { data: { error?: string } }).data.error
      }
      // Direct error property
      if ('error' in error) {
        return (error as { error?: string }).error
      }
      // Error code property
      if ('code' in error) {
        return (error as { code?: string }).code
      }
    }
    return undefined
  }

  private buildMessage(event: DomainEvent): { text: string; blocks?: unknown[] } {
    // Get the root URL for links
    const rootUrl = this.getRootUrl()

    switch (event.type) {
      case 'post.created': {
        const { post } = event.data as PostCreatedPayload
        const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
        const content = this.stripHtml(post.content)
        const author = post.authorEmail || 'Anonymous'

        return {
          text: `New post from ${author}: ${post.title}`,
          blocks: [
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `📬 New post from ${author}`,
                },
              ],
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `> *<${postUrl}|${this.escapeSlackMrkdwn(post.title)}>*\n${this.quoteText(this.escapeSlackMrkdwn(content))}`,
              },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `in <${rootUrl}/?board=${post.boardSlug}|${post.boardSlug}>`,
                },
              ],
            },
          ],
        }
      }

      case 'post.status_changed': {
        const { post, previousStatus, newStatus } = event.data as PostStatusChangedPayload
        const postUrl = `${rootUrl}/b/${post.boardSlug}/posts/${post.id}`
        const emoji = this.getStatusEmoji(newStatus)
        const actor = event.actor.email || 'System'

        return {
          text: `Status updated by ${actor}: ${post.title}`,
          blocks: [
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `${emoji} Status updated by ${actor}`,
                },
              ],
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `> *<${postUrl}|${this.escapeSlackMrkdwn(post.title)}>*\n> ${this.capitalizeStatus(previousStatus)} → *${this.capitalizeStatus(newStatus)}*`,
              },
            },
          ],
        }
      }

      case 'comment.created': {
        const { comment, post } = event.data as CommentCreatedPayload
        // Note: comment events don't have boardSlug yet, use generic URL
        const postUrl = `${rootUrl}/posts/${post.id}`
        const content = this.stripHtml(comment.content)
        const author = comment.authorEmail || 'Anonymous'

        return {
          text: `New comment from ${author}: ${post.title}`,
          blocks: [
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `💬 New comment from ${author}`,
                },
              ],
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `> *<${postUrl}|${this.escapeSlackMrkdwn(post.title)}>*\n${this.quoteText(this.escapeSlackMrkdwn(content))}`,
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
   * Formats text as a Slack quote block by prefixing each line with '>'.
   */
  private quoteText(text: string): string {
    return text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
  }

  /**
   * Get the root URL for links in notifications.
   * Requires ROOT_URL environment variable.
   */
  private getRootUrl(): string {
    const url = process.env.ROOT_URL
    if (!url) {
      throw new Error('ROOT_URL environment variable is required for Slack notifications')
    }
    return url
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

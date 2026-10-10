/**
 * Slack hook handler.
 * Sends messages to Slack channels when events occur.
 */

import { WebClient } from '@slack/web-api'
import { recordDeliveryOutcome } from '@/lib/server/integrations/sync/transport'
import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { buildSlackMessage } from '@/integrations/slack/server/message'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'slack' })

/**
 * Slack hook target.
 */
export interface SlackTarget {
  channelId: string
}

/**
 * Slack hook config.
 */
export interface SlackConfig {
  accessToken: string
  /** Portal base URL for constructing post links */
  rootUrl: string
}

// OAuth errors that indicate token is invalid/expired (don't retry these)
const AUTH_ERRORS = ['invalid_auth', 'token_revoked', 'token_expired', 'account_inactive']

/**
 * Extract Slack error code from various error formats.
 */
function getSlackErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined

  const err = error as Record<string, unknown>
  const data = err.data as Record<string, unknown> | undefined

  return (data?.error ?? err.error ?? err.code) as string | undefined
}

/**
 * Check if an error is an OAuth authentication failure.
 */
function isAuthError(error: unknown): boolean {
  const code = getSlackErrorCode(error)
  return code !== undefined && AUTH_ERRORS.includes(code)
}

function slackDeliveryError(error: unknown): DeliveryOutcome {
  const code = getSlackErrorCode(error)
  if (isAuthError(error)) return { state: 'auth_required', errorCode: 'authentication' }
  if (code === 'slack_webapi_rate_limited_error' || code === 'ratelimited') {
    const seconds = Number((error as { retryAfter?: unknown }).retryAfter)
    return {
      state: 'retry_wait',
      errorCode: 'unavailable',
      ...(Number.isFinite(seconds) && seconds >= 0
        ? { retryAfterMs: Math.ceil(seconds * 1000) }
        : {}),
    }
  }
  // Slack platform errors are explicit rejections; transport/HTTP failures can be ambiguous.
  if (
    error &&
    typeof error === 'object' &&
    (error as { code?: string }).code === 'slack_webapi_platform_error'
  )
    return { state: 'failed', errorCode: 'provider_failed' }
  return { state: 'uncertain', errorCode: 'outcome_unknown' }
}

/**
 * Post a message to a channel, auto-joining public channels if needed.
 */
async function postMessage(
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
    const errorCode = getSlackErrorCode(error)
    log.debug({ error_code: errorCode }, 'post message failed, evaluating retry')

    // If not in channel, try to join (only works for public channels)
    if (errorCode === 'not_in_channel' || errorCode === 'channel_not_found') {
      log.debug({ channel_id: channelId }, 'attempting to join channel')
      const joinResult = await client.conversations.join({ channel: channelId })
      if (joinResult.ok) recordDeliveryOutcome({ state: 'succeeded' })

      if (!joinResult.ok) {
        log.warn({ channel_id: channelId, join_error: joinResult.error }, 'failed to join channel')
        throw new Error(
          `Cannot post to this channel. Please invite the bot to the channel first.`,
          { cause: error }
        )
      }

      log.debug({ channel_id: channelId }, 'joined channel, retrying message')
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

export const slackHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId } = target as SlackTarget
    const { accessToken, rootUrl } = config as SlackConfig

    log.debug({ event_type: event.type, channel_id: channelId }, 'processing hook event')

    const message = buildSlackMessage(event, rootUrl)
    if (!message) {
      log.debug({ event_type: event.type }, 'event produces no slack message, skipping')
      return { state: 'succeeded' }
    }

    const client = new WebClient(accessToken, {
      retryConfig: { retries: 0 },
      timeout: 20_000,
      rejectRateLimitedCalls: true,
    })

    try {
      const result = await postMessage(client, channelId, message)

      if (result.ok) {
        log.info({ channel_id: channelId, message_ts: result.ts }, 'posted message to channel')
      } else {
        log.error({ channel_id: channelId, error_code: result.error }, 'failed to post message')
      }

      return result.ok === true
        ? { state: 'succeeded', result: { externalId: result.ts } }
        : { state: 'uncertain', errorCode: 'outcome_unknown' }
    } catch (error) {
      const errorCode = getSlackErrorCode(error)
      log.error({ err: error, error_code: errorCode }, 'hook delivery failed')

      return slackDeliveryError(error)
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken } = config as SlackConfig
    try {
      const client = new WebClient(accessToken)
      const result = await client.auth.test()
      return { ok: result.ok === true, error: result.error }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}

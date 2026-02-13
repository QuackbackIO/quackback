/**
 * Slack hook handler.
 * Sends messages to Slack channels when events occur.
 */

import { WebClient } from '@slack/web-api'
import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildSlackMessage } from './message'

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
    console.log(`[Slack] API error: ${errorCode}`)

    // If not in channel, try to join (only works for public channels)
    if (errorCode === 'not_in_channel' || errorCode === 'channel_not_found') {
      console.log(`[Slack] Attempting to join channel ${channelId}`)
      const joinResult = await client.conversations.join({ channel: channelId })

      if (!joinResult.ok) {
        console.error(`[Slack] Failed to join: ${joinResult.error}`)
        throw new Error(
          `Cannot post to this channel. Please invite the bot to the channel first.`,
          { cause: error }
        )
      }

      console.log(`[Slack] Joined ${channelId}, retrying message`)
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

export const slackHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId } = target as SlackTarget
    const { accessToken, rootUrl } = config as SlackConfig

    console.log(`[Slack] Processing ${event.type} → channel ${channelId}`)

    const client = new WebClient(accessToken)
    const message = buildSlackMessage(event, rootUrl)

    try {
      const result = await postMessage(client, channelId, message)

      if (result.ok) {
        console.log(`[Slack] ✅ Posted to ${channelId} (ts=${result.ts})`)
      } else {
        console.error(`[Slack] ❌ Failed: ${result.error}`)
      }

      return {
        success: result.ok === true,
        externalId: result.ts,
        error: result.error,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      const errorCode = getSlackErrorCode(error)
      console.error(`[Slack] ❌ Exception: ${errorMsg}${errorCode ? ` (${errorCode})` : ''}`)

      // Auth errors should not be retried - they require reconnecting Slack
      if (isAuthError(error)) {
        console.error(
          `[Slack] OAuth token invalid (${errorCode}). Please reconnect Slack integration.`
        )
        return {
          success: false,
          error: `Authentication failed: ${errorCode}. Please reconnect Slack.`,
          shouldRetry: false,
        }
      }

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
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

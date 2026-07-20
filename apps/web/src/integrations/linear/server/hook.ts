/**
 * Linear hook handler.
 * Creates Linear issues when feedback events occur.
 */

import type { HookHandler, HookResult } from '@/lib/server/events/hook-types'
import type { EventData } from '@/lib/server/events/types'
import { isRetryableError } from '@/lib/server/events/hook-utils'
import { buildLinearIssueBody } from '@/integrations/linear/server/message'
import { linearIssues } from '@/integrations/linear/server/issues'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'linear' })

export interface LinearTarget {
  channelId: string // teamId is stored as channelId for consistency
}

export interface LinearConfig {
  accessToken: string
  rootUrl: string
}

export const linearHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId: teamId } = target as LinearTarget
    const { accessToken, rootUrl } = config as LinearConfig

    // Only create issues for new feedback
    if (event.type !== 'post.created') {
      return { success: true }
    }

    log.debug({ event_type: event.type, team_id: teamId }, 'creating issue')

    const { title, description } = buildLinearIssueBody(event, rootUrl)

    try {
      // The capability owns the GraphQL call + error classification; this
      // hook maps its thrown errors back onto the HookResult retry contract.
      const created = await linearIssues.create!({
        auth: { channelId: teamId, accessToken },
        title,
        bodyMarkdown: description,
      })

      log.info(
        {
          issue_id: created.externalId,
          issue_identifier: created.externalDisplayId,
          team_id: teamId,
        },
        'issue created'
      )
      return {
        success: true,
        externalId: created.externalId,
        externalDisplayId: created.externalDisplayId ?? undefined,
        externalUrl: created.externalUrl ?? undefined,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      const status = (error as { status?: number }).status

      if (status === 401) {
        return {
          success: false,
          error: 'Authentication failed. Please reconnect Linear.',
          shouldRetry: false,
        }
      }

      const retryable = (error as { retryable?: boolean }).retryable
      return {
        success: false,
        error: errorMsg,
        shouldRetry: retryable ?? isRetryableError(error),
      }
    }
  },
}

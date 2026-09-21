import { deliveryError } from '@/lib/server/integrations/sync/outcomes'
/**
 * Linear hook handler.
 * Creates Linear issues when feedback events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
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

export const linearHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId: teamId } = target as LinearTarget
    const { accessToken, rootUrl } = config as LinearConfig

    // Only create issues for new feedback
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    log.debug({ event_type: event.type, team_id: teamId }, 'creating issue')

    const { title, description } = buildLinearIssueBody(event, rootUrl)

    try {
      // The capability owns the GraphQL call + error classification; this
      // hook returns the same explicit delivery outcome as every provider.
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
        state: 'succeeded',
        result: {
          externalId: created.externalId,
          externalDisplayId: created.externalDisplayId ?? undefined,
          externalUrl: created.externalUrl ?? undefined,
        },
      }
    } catch (error) {
      return deliveryError(error)
    }
  },
}

import { deliveryError } from '@/lib/server/integrations/sync/outcomes'
/**
 * GitHub hook handler.
 * Creates GitHub issues when feedback events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { buildGitHubIssueBody } from '@/integrations/github/server/message'
import { githubIssues } from '@/integrations/github/server/issues'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'github' })

export interface GitHubTarget {
  channelId: string // "owner/repo" stored as channelId for consistency
}

export interface GitHubConfig {
  accessToken: string
  rootUrl: string
}

export const githubHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId: ownerRepo } = target as GitHubTarget
    const { accessToken, rootUrl } = config as GitHubConfig

    // Only create issues for new feedback
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    log.debug({ event_type: event.type, repo: ownerRepo }, 'creating issue')

    const { title, body } = buildGitHubIssueBody(event, rootUrl)

    try {
      // The capability owns the API call + error classification; this hook
      // returns the same explicit delivery outcome as every provider.
      const created = await githubIssues.create!({
        auth: { channelId: ownerRepo, accessToken },
        title,
        bodyMarkdown: body,
      })

      log.info({ issue_ref: created.externalDisplayId, repo: ownerRepo }, 'issue created')
      return {
        state: 'succeeded',
        result: {
          externalId: created.externalId,
          externalDisplayId: created.externalDisplayId,
          externalUrl: created.externalUrl ?? undefined,
        },
      }
    } catch (error) {
      return deliveryError(error)
    }
  },
}

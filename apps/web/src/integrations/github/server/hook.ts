/**
 * GitHub hook handler.
 * Creates GitHub issues when feedback events occur.
 */

import type { HookHandler, HookResult } from '@/lib/server/events/hook-types'
import type { EventData } from '@/lib/server/events/types'
import { isRetryableError } from '@/lib/server/events/hook-utils'
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

export const githubHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId: ownerRepo } = target as GitHubTarget
    const { accessToken, rootUrl } = config as GitHubConfig

    // Only create issues for new feedback
    if (event.type !== 'post.created') {
      return { success: true }
    }

    log.debug({ event_type: event.type, repo: ownerRepo }, 'creating issue')

    const { title, body } = buildGitHubIssueBody(event, rootUrl)

    try {
      // The capability owns the API call + error classification; this hook
      // maps its thrown errors back onto the HookResult retry contract.
      const created = await githubIssues.create!({
        auth: { channelId: ownerRepo, accessToken },
        title,
        bodyMarkdown: body,
      })

      log.info({ issue_ref: created.externalDisplayId, repo: ownerRepo }, 'issue created')
      return {
        success: true,
        externalId: created.externalId,
        externalDisplayId: created.externalDisplayId,
        externalUrl: created.externalUrl ?? undefined,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      const retryable = (error as { retryable?: boolean }).retryable

      return {
        success: false,
        error: errorMsg,
        shouldRetry: retryable ?? isRetryableError(error),
      }
    }
  },
}

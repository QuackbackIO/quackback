import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
/**
 * GitLab hook handler.
 * Creates issues in GitLab when events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { buildGitLabIssue } from '@/integrations/gitlab/server/message'
import { gitlabApiBase } from '@/integrations/gitlab/server/url'
import { gitlabFetch } from '@/integrations/gitlab/server/fetch'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'gitlab' })

export interface GitLabTarget {
  channelId: string // projectId stored as channelId for consistency
}

export interface GitLabConfig {
  accessToken: string
  rootUrl: string
  /** Origin of a self-hosted GitLab instance; omitted for gitlab.com. */
  instanceUrl?: string
}

export const gitlabHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    const { channelId: projectId } = target as GitLabTarget
    const { accessToken, rootUrl, instanceUrl } = config as GitLabConfig
    const api = gitlabApiBase(instanceUrl)

    log.debug({ event_type: event.type, project_id: projectId }, 'processing event')

    const { title, description } = buildGitLabIssue(event, rootUrl)

    try {
      const response = await gitlabFetch(
        `${api}/projects/${encodeURIComponent(projectId)}/issues`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title, description }),
        }
      )

      if (!response.ok) {
        return httpDeliveryFailure(response)
      }

      const data = (await response.json()) as { iid: number; web_url: string }
      log.info({ issue_iid: data.iid, project_id: projectId }, 'issue created')

      return {
        state: 'succeeded',
        result: { externalId: String(data.iid), externalUrl: data.web_url },
      }
    } catch (error) {
      log.error({ err: error, project_id: projectId }, 'issue creation failed')

      return deliveryError(error)
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken, instanceUrl } = config as GitLabConfig
    try {
      const response = await gitlabFetch(`${gitlabApiBase(instanceUrl)}/user`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}

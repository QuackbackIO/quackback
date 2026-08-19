/**
 * GitLab hook handler.
 * Creates issues in GitLab when events occur.
 */

import type { HookHandler, HookResult } from '@/lib/server/events/hook-types'
import type { EventData } from '@/lib/server/events/types'
import { isRetryableError } from '@/lib/server/events/hook-utils'
import { buildGitLabIssue } from '@/integrations/gitlab/server/message'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'gitlab' })

const GITLAB_API = 'https://gitlab.com/api/v4'

export interface GitLabTarget {
  channelId: string // projectId stored as channelId for consistency
}

export interface GitLabConfig {
  accessToken: string
  rootUrl: string
}

export const gitlabHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    if (event.type !== 'post.created') {
      return { success: true }
    }

    const { channelId: projectId } = target as GitLabTarget
    const { accessToken, rootUrl } = config as GitLabConfig

    log.debug({ event_type: event.type, project_id: projectId }, 'processing event')

    const { title, description } = buildGitLabIssue(event, rootUrl)

    try {
      const response = await fetch(
        `${GITLAB_API}/projects/${encodeURIComponent(projectId)}/issues`,
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
        const errorBody = await response.text()
        const status = response.status

        if (status === 401 || status === 403) {
          log.error({ status_code: status, project_id: projectId, body: errorBody }, 'auth error')
          return {
            success: false,
            error: `Authentication failed (${status}). Please reconnect GitLab.`,
            shouldRetry: false,
          }
        }

        if (status === 429) {
          log.warn({ status_code: status, project_id: projectId, body: errorBody }, 'rate limited')
          return { success: false, error: 'Rate limited', shouldRetry: true }
        }

        log.error({ status_code: status, project_id: projectId, body: errorBody }, 'api error')
        return {
          success: false,
          error: `GitLab API error: ${status}`,
          shouldRetry: status >= 500,
        }
      }

      const data = (await response.json()) as { iid: number; web_url: string }
      log.info({ issue_iid: data.iid, project_id: projectId }, 'issue created')

      return { success: true, externalId: String(data.iid), externalUrl: data.web_url }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ err: error, project_id: projectId }, 'issue creation failed')

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },

  async testConnection(config: unknown): Promise<{ ok: boolean; error?: string }> {
    const { accessToken } = config as GitLabConfig
    try {
      const response = await fetch(`${GITLAB_API}/user`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return { ok: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' }
    }
  },
}

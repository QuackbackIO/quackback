/**
 * GitLab hook handler.
 * Creates issues in GitLab when events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildGitLabIssue } from './message'

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

    console.log(`[GitLab] Processing ${event.type} → project ${projectId}`)

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
          console.error(`[GitLab] ❌ Auth error (${status}): ${errorBody}`)
          return {
            success: false,
            error: `Authentication failed (${status}). Please reconnect GitLab.`,
            shouldRetry: false,
          }
        }

        if (status === 429) {
          console.warn(`[GitLab] ⚠️ Rate limited: ${errorBody}`)
          return { success: false, error: 'Rate limited', shouldRetry: true }
        }

        console.error(`[GitLab] ❌ API error (${status}): ${errorBody}`)
        return {
          success: false,
          error: `GitLab API error: ${status}`,
          shouldRetry: status >= 500,
        }
      }

      const data = (await response.json()) as { iid: number; web_url: string }
      console.log(`[GitLab] ✅ Created issue #${data.iid}`)

      return { success: true, externalId: String(data.iid), externalUrl: data.web_url }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[GitLab] ❌ Exception: ${errorMsg}`)

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

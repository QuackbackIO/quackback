/**
 * GitHub hook handler.
 * Creates GitHub issues when feedback events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildGitHubIssueBody } from './message'

const GITHUB_API = 'https://api.github.com'

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

    console.log(`[GitHub] Creating issue for ${event.type} -> repo ${ownerRepo}`)

    const { title, body } = buildGitHubIssueBody(event, rootUrl)

    try {
      const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'quackback',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ title, body }),
      })

      if (!response.ok) {
        const status = response.status
        const errorBody = await response.text()

        if (status === 401) {
          return {
            success: false,
            error: 'Authentication failed. Please reconnect GitHub.',
            shouldRetry: false,
          }
        }

        if (status === 404) {
          return {
            success: false,
            error: `Repository "${ownerRepo}" not found or not accessible.`,
            shouldRetry: false,
          }
        }

        if (status === 422) {
          return {
            success: false,
            error: `Validation error: ${errorBody}`,
            shouldRetry: false,
          }
        }

        if (status === 429) {
          return {
            success: false,
            error: 'Rate limited by GitHub API.',
            shouldRetry: true,
          }
        }

        throw Object.assign(new Error(`HTTP ${status}: ${errorBody}`), { status })
      }

      const issue = (await response.json()) as {
        number: number
        html_url: string
      }

      console.log(`[GitHub] Created issue #${issue.number} in ${ownerRepo}`)
      return {
        success: true,
        externalId: String(issue.number),
        externalUrl: issue.html_url,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'

      return {
        success: false,
        error: errorMsg,
        shouldRetry: isRetryableError(error),
      }
    }
  },
}

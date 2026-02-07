/**
 * Jira hook handler.
 * Creates Jira issues when feedback events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildJiraIssueBody } from './message'

export interface JiraTarget {
  channelId: string // projectId is stored as channelId for consistency
}

export interface JiraConfig {
  accessToken: string
  cloudId: string
  siteUrl?: string
  issueTypeId?: string
  rootUrl: string
}

async function jiraApi(
  method: string,
  url: string,
  accessToken: string,
  body?: unknown
): Promise<Response> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!response.ok) {
    const status = response.status
    if (status === 401) throw Object.assign(new Error('Unauthorized'), { status })
    if (status === 429) throw Object.assign(new Error('Rate limited'), { status })
    if (status >= 500) throw Object.assign(new Error(`Server error ${status}`), { status })
    throw Object.assign(new Error(`HTTP ${status}`), { status })
  }

  return response
}

export const jiraHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId: projectId } = target as JiraTarget
    const { accessToken, cloudId, siteUrl, issueTypeId, rootUrl } = config as JiraConfig

    // Only create issues for new feedback
    if (event.type !== 'post.created') {
      return { success: true }
    }

    console.log(`[Jira] Creating issue for ${event.type} -> project ${projectId}`)

    const { title, description } = buildJiraIssueBody(event, rootUrl)

    const issueBody: Record<string, unknown> = {
      fields: {
        project: { id: projectId },
        summary: title,
        description,
        ...(issueTypeId ? { issuetype: { id: issueTypeId } } : {}),
      },
    }

    try {
      const apiUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`
      const response = await jiraApi('POST', apiUrl, accessToken, issueBody)
      const result = (await response.json()) as { id?: string; key?: string; self?: string }

      if (!result.key) {
        return { success: false, error: 'No issue key returned', shouldRetry: false }
      }

      const issueUrl = siteUrl
        ? `${siteUrl}/browse/${result.key}`
        : `https://api.atlassian.com/ex/jira/${cloudId}/browse/${result.key}`
      console.log(`[Jira] Created issue ${result.key}`)
      return { success: true, externalId: result.key, externalUrl: issueUrl }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      const status = (error as { status?: number }).status

      if (status === 401) {
        return {
          success: false,
          error: 'Authentication failed. Please reconnect Jira.',
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
}

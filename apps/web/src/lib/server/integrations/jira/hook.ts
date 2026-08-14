/**
 * Jira hook handler.
 * Creates Jira issues when feedback events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildJiraIssueBody } from './message'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'jira' })

export interface JiraTarget {
  channelId: string
}

/** Settings stores `projectId:issueTypeId`; a bare project id is still accepted. */
export function parseJiraChannelId(channelId: string): {
  projectId: string
  issueTypeId?: string
} {
  const sep = channelId.indexOf(':')
  if (sep === -1) return { projectId: channelId }
  const projectId = channelId.slice(0, sep)
  const issueTypeId = channelId.slice(sep + 1)
  return { projectId, ...(issueTypeId ? { issueTypeId } : {}) }
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
    const { channelId } = target as JiraTarget
    const { accessToken, cloudId, siteUrl, issueTypeId, rootUrl } = config as JiraConfig

    if (event.type !== 'post.created') {
      return { success: true }
    }

    if (!cloudId) {
      return {
        success: false,
        error: 'Jira cloud ID is missing from integration config',
        shouldRetry: false,
      }
    }
    if (!accessToken) {
      return {
        success: false,
        error: 'Jira access token is missing',
        shouldRetry: false,
      }
    }

    const parsed = parseJiraChannelId(channelId)
    const projectId = parsed.projectId
    const resolvedIssueTypeId = issueTypeId || parsed.issueTypeId

    log.debug({ event_type: event.type, project_id: projectId }, 'creating issue')

    const { title, description } = buildJiraIssueBody(event, rootUrl)

    const issueBody: Record<string, unknown> = {
      fields: {
        project: { id: projectId },
        summary: title,
        description,
        ...(resolvedIssueTypeId ? { issuetype: { id: resolvedIssueTypeId } } : {}),
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
      log.info({ issue_key: result.key }, 'issue created')
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

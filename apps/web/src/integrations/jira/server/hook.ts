import { deliveryError, httpDeliveryFailure } from '@/lib/server/integrations/sync/outcomes'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Jira hook handler.
 * Creates Jira issues when feedback events occur.
 */

import type { IntegrationHook, DeliveryOutcome } from '@/lib/server/integrations/sync/outcomes'
import type { EventData } from '@/lib/server/events/types'
import { buildJiraIssueBody } from '@/integrations/jira/server/message'
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

export const jiraHook: IntegrationHook = {
  async run(event: EventData, target: unknown, config: unknown): Promise<DeliveryOutcome> {
    const { channelId } = target as JiraTarget
    const { accessToken, cloudId, siteUrl, issueTypeId, rootUrl } = config as JiraConfig

    if (event.type !== 'post.created') {
      return { state: 'succeeded' }
    }

    if (!cloudId) {
      return { state: 'failed', errorCode: 'provider_failed' }
    }
    if (!accessToken) {
      return { state: 'failed', errorCode: 'provider_failed' }
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
      const response = await integrationFetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(issueBody),
      })
      if (!response.ok) return httpDeliveryFailure(response)
      const result = (await response.json()) as { id?: string; key?: string; self?: string }

      if (!result.key) {
        return { state: 'uncertain', errorCode: 'outcome_unknown' }
      }

      const issueUrl = siteUrl
        ? `${siteUrl}/browse/${result.key}`
        : `https://api.atlassian.com/ex/jira/${cloudId}/browse/${result.key}`
      log.info({ issue_key: result.key }, 'issue created')
      return { state: 'succeeded', result: { externalId: result.key, externalUrl: issueUrl } }
    } catch (error) {
      return deliveryError(error)
    }
  },
}

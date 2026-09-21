import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Linear issue-tracker capability: issue creation. No `parseRef` on purpose —
 * Linear's inbound webhook identifies issues by internal UUID (`data.id`),
 * which a pasted URL cannot supply, so manual linking is not offered. The
 * create path is fine: the GraphQL response returns the UUID, so a created
 * issue's link row lands in the correct externalId namespace for inbound
 * status sync.
 */
import type { IssueTrackerCapability, ParsedIssueRef } from '@/lib/server/integrations/types'
import { issueError } from '@/lib/server/integrations/message-utils'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'linear' })

const LINEAR_API = 'https://api.linear.app/graphql'

const CREATE_ISSUE_MUTATION = `
  mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        identifier
        url
      }
    }
  }
`

async function linearGraphql(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data?: Record<string, unknown>; errors?: Array<{ message: string }> }> {
  const response = await integrationFetch(LINEAR_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    const status = response.status
    if (status === 401) throw issueError('Unauthorized', { status })
    if (status === 429) throw issueError('Rate limited', { status, retryable: true })
    throw issueError(`HTTP ${status}`, { status })
  }

  return response.json() as Promise<{
    data?: Record<string, unknown>
    errors?: Array<{ message: string }>
  }>
}

export const linearIssues: IssueTrackerCapability = {
  async inspect({ auth, reference }) {
    if (!/^(?:[a-zA-Z][a-zA-Z0-9]*-\d+|[a-fA-F0-9-]{36})$/.test(reference))
      throw new Error('Use the Linear issue identifier or model UUID')
    const result = await linearGraphql(
      String(auth.accessToken),
      'query SyncIssue($id: String!) { issue(id: $id) { id identifier url title description updatedAt team { id } } }',
      { id: reference }
    )
    const issue = result.data?.issue as
      | {
          id: string
          identifier: string
          url: string
          title: string
          description: string | null
          updatedAt: string
          team: { id: string }
        }
      | undefined
    if (result.errors?.length || !issue || issue.team.id !== auth.channelId)
      throw new Error('Issue is unavailable in this destination')
    return {
      externalId: issue.id,
      externalDisplayId: issue.identifier,
      externalUrl: issue.url,
      title: issue.title,
      content: issue.description ?? '',
      version: issue.updatedAt,
    }
  },
  async create({ auth, title, bodyMarkdown }): Promise<ParsedIssueRef> {
    const teamId = auth.channelId as string
    const accessToken = auth.accessToken as string

    const result = await linearGraphql(accessToken, CREATE_ISSUE_MUTATION, {
      input: { teamId, title, description: bodyMarkdown },
    })

    if (result.errors?.length) {
      log.error({ error_message: result.errors[0].message, team_id: teamId }, 'graphql error')
      throw issueError(result.errors[0].message, { retryable: false })
    }
    const issue = (
      result.data?.issueCreate as { issue?: { id: string; identifier: string; url: string } }
    )?.issue
    if (!issue) {
      throw issueError('No issue returned', { retryable: false })
    }

    return { externalId: issue.id, externalDisplayId: issue.identifier, externalUrl: issue.url }
  },
}

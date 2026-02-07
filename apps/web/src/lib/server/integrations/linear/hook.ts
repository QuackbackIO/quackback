/**
 * Linear hook handler.
 * Creates Linear issues when feedback events occur.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildLinearIssueBody } from './message'

const LINEAR_API = 'https://api.linear.app/graphql'

export interface LinearTarget {
  channelId: string // teamId is stored as channelId for consistency
}

export interface LinearConfig {
  accessToken: string
  rootUrl: string
}

async function graphql(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data?: Record<string, unknown>; errors?: Array<{ message: string }> }> {
  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    const status = response.status
    if (status === 401) throw Object.assign(new Error('Unauthorized'), { status })
    if (status === 429) throw Object.assign(new Error('Rate limited'), { status })
    throw Object.assign(new Error(`HTTP ${status}`), { status })
  }

  return response.json() as Promise<{
    data?: Record<string, unknown>
    errors?: Array<{ message: string }>
  }>
}

export const linearHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId: teamId } = target as LinearTarget
    const { accessToken, rootUrl } = config as LinearConfig

    // Only create issues for new feedback
    if (event.type !== 'post.created') {
      return { success: true }
    }

    console.log(`[Linear] Creating issue for ${event.type} → team ${teamId}`)

    const { title, description } = buildLinearIssueBody(event, rootUrl)

    try {
      const result = await graphql(accessToken, CREATE_ISSUE_MUTATION, {
        input: { teamId, title, description },
      })

      if (result.errors?.length) {
        const errorMsg = result.errors[0].message
        console.error(`[Linear] ❌ GraphQL error: ${errorMsg}`)
        return {
          success: false,
          error: errorMsg,
          shouldRetry: false,
        }
      }

      const issue = (result.data?.issueCreate as { issue?: { id: string; url: string } })?.issue
      if (!issue) {
        return { success: false, error: 'No issue returned', shouldRetry: false }
      }

      console.log(`[Linear] ✅ Created issue ${issue.id}`)
      return { success: true, externalId: issue.id, externalUrl: issue.url }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      const status = (error as { status?: number }).status

      if (status === 401) {
        return {
          success: false,
          error: 'Authentication failed. Please reconnect Linear.',
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

const CREATE_ISSUE_MUTATION = `
  mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        url
      }
    }
  }
`

/**
 * Server functions for fetching external statuses from integration platforms.
 * Used by the status mapping UI to show available statuses for mapping.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { db, integrations, eq } from '@/lib/server/db'
import { decryptSecrets } from '@/lib/server/integrations/encryption'

const fetchExternalStatusesSchema = z.object({
  integrationType: z.string(),
})

export interface ExternalStatusItem {
  id: string
  name: string
}

/**
 * Fetch available statuses from an external platform.
 * Routes to the appropriate platform-specific fetcher.
 */
export const fetchExternalStatusesFn = createServerFn({ method: 'POST' })
  .inputValidator(fetchExternalStatusesSchema)
  .handler(async ({ data }): Promise<ExternalStatusItem[]> => {
    await requireAuth({ roles: ['admin'] })

    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, data.integrationType),
    })
    if (!integration?.secrets || integration.status !== 'active') {
      return []
    }

    const secrets = decryptSecrets<{ accessToken?: string }>(integration.secrets)
    if (!secrets.accessToken) return []

    const config = (integration.config ?? {}) as Record<string, unknown>

    switch (data.integrationType) {
      case 'linear':
        return fetchLinearStatuses(secrets.accessToken, config.channelId as string | undefined)
      case 'github':
        // GitHub has fixed statuses
        return [
          { id: 'Open', name: 'Open' },
          { id: 'Closed', name: 'Closed' },
        ]
      case 'jira':
        return fetchJiraStatuses(secrets.accessToken, config)
      case 'clickup':
        return fetchClickUpStatuses(secrets.accessToken, config)
      case 'asana':
        return fetchAsanaSections(secrets.accessToken, config)
      case 'shortcut':
        return fetchShortcutStates(secrets.accessToken)
      case 'azure_devops':
        // Azure DevOps common states — can be customized per project
        return [
          { id: 'New', name: 'New' },
          { id: 'Active', name: 'Active' },
          { id: 'Resolved', name: 'Resolved' },
          { id: 'Closed', name: 'Closed' },
        ]
      default:
        return []
    }
  })

async function fetchLinearStatuses(
  accessToken: string,
  teamId?: string
): Promise<ExternalStatusItem[]> {
  const query = teamId
    ? `{ team(id: "${teamId}") { states { nodes { id name } } } }`
    : '{ workflowStates { nodes { id name } } }'

  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })

  if (!response.ok) return []
  const data = (await response.json()) as {
    data?: {
      team?: { states?: { nodes?: Array<{ id: string; name: string }> } }
      workflowStates?: { nodes?: Array<{ id: string; name: string }> }
    }
  }

  const nodes = data.data?.team?.states?.nodes ?? data.data?.workflowStates?.nodes ?? []
  return nodes.map((n) => ({ id: n.name, name: n.name }))
}

async function fetchJiraStatuses(
  accessToken: string,
  config: Record<string, unknown>
): Promise<ExternalStatusItem[]> {
  const cloudId = config.cloudId as string | undefined
  if (!cloudId) return []

  const response = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/status`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) return []
  const statuses = (await response.json()) as Array<{ id: string; name: string }>
  // Deduplicate by name (Jira has duplicate status names across projects)
  const seen = new Set<string>()
  return statuses
    .filter((s) => {
      if (seen.has(s.name)) return false
      seen.add(s.name)
      return true
    })
    .map((s) => ({ id: s.name, name: s.name }))
}

async function fetchClickUpStatuses(
  accessToken: string,
  config: Record<string, unknown>
): Promise<ExternalStatusItem[]> {
  const listId = config.channelId as string | undefined
  if (!listId) return []

  const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) return []
  const list = (await response.json()) as {
    statuses?: Array<{ status: string; orderindex: number }>
  }

  return (list.statuses ?? []).map((s) => ({ id: s.status, name: s.status }))
}

async function fetchAsanaSections(
  accessToken: string,
  config: Record<string, unknown>
): Promise<ExternalStatusItem[]> {
  const projectGid = config.channelId as string | undefined
  if (!projectGid) return []

  const response = await fetch(`https://app.asana.com/api/1.0/projects/${projectGid}/sections`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) return []
  const data = (await response.json()) as {
    data?: Array<{ gid: string; name: string }>
  }

  return (data.data ?? []).map((s) => ({ id: s.name, name: s.name }))
}

async function fetchShortcutStates(accessToken: string): Promise<ExternalStatusItem[]> {
  const response = await fetch('https://api.app.shortcut.com/api/v3/workflows', {
    headers: {
      'Shortcut-Token': accessToken,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) return []
  const workflows = (await response.json()) as Array<{
    states?: Array<{ id: number; name: string }>
  }>

  // Flatten all workflow states
  const states: ExternalStatusItem[] = []
  for (const workflow of workflows) {
    for (const state of workflow.states ?? []) {
      states.push({ id: state.name, name: state.name })
    }
  }
  return states
}

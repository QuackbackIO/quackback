import type { ExternalStatusItem } from '../types'

/** Fetch Linear workflow states for the status-mapping UI (team-scoped when configured). */
export async function fetchLinearStatuses(params: {
  accessToken: string
  config: Record<string, unknown>
}): Promise<ExternalStatusItem[]> {
  const teamId = params.config.channelId as string | undefined
  const query = teamId
    ? `{ team(id: "${teamId}") { states { nodes { id name } } } }`
    : '{ workflowStates { nodes { id name } } }'

  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
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

import type { ExternalStatusItem } from '@/lib/server/integrations/types'

/**
 * Fetch Linear workflow state names for the status-mapping UI.
 *
 * Every public team, deduplicated by name: the webhook covers every public
 * team and mappings are keyed by state NAME, so a state that exists in two
 * teams under one name is one mapping, and a name that exists only in the
 * team an issue was moved to still has to be offered.
 */
export async function fetchLinearStatuses(params: {
  accessToken: string
  config: Record<string, unknown>
}): Promise<ExternalStatusItem[]> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: '{ workflowStates { nodes { id name } } }' }),
  })

  if (!response.ok) return []
  const data = (await response.json()) as {
    data?: { workflowStates?: { nodes?: Array<{ id: string; name: string }> } }
  }

  const names = new Set<string>()
  for (const node of data.data?.workflowStates?.nodes ?? []) names.add(node.name)
  return [...names].map((name) => ({ id: name, name }))
}

import type { ExternalStatusItem } from '@/lib/server/integrations/types'

/** Fetch Jira statuses for the status-mapping UI, deduplicated by name. */
export async function fetchJiraStatuses(params: {
  accessToken: string
  config: Record<string, unknown>
}): Promise<ExternalStatusItem[]> {
  const cloudId = params.config.cloudId as string | undefined
  if (!cloudId) return []

  const response = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/status`, {
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
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

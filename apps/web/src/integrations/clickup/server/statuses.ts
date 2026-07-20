import type { ExternalStatusItem } from '@/lib/server/integrations/types'

/** Fetch ClickUp list statuses for the status-mapping UI. */
export async function fetchClickUpStatuses(params: {
  accessToken: string
  config: Record<string, unknown>
}): Promise<ExternalStatusItem[]> {
  const listId = params.config.channelId as string | undefined
  if (!listId) return []

  const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}`, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  })

  if (!response.ok) return []
  const list = (await response.json()) as {
    statuses?: Array<{ status: string; orderindex: number }>
  }

  return (list.statuses ?? []).map((s) => ({ id: s.status, name: s.status }))
}

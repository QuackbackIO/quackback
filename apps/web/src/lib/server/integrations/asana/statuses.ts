import type { ExternalStatusItem } from '../types'

/** Fetch Asana project sections for the status-mapping UI. */
export async function fetchAsanaSections(params: {
  accessToken: string
  config: Record<string, unknown>
}): Promise<ExternalStatusItem[]> {
  const projectGid = params.config.channelId as string | undefined
  if (!projectGid) return []

  const response = await fetch(`https://app.asana.com/api/1.0/projects/${projectGid}/sections`, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  })

  if (!response.ok) return []
  const data = (await response.json()) as {
    data?: Array<{ gid: string; name: string }>
  }

  return (data.data ?? []).map((s) => ({ id: s.name, name: s.name }))
}

/**
 * GitLab project listing.
 */

import { gitlabApiBase } from '@/integrations/gitlab/server/url'
import { gitlabFetch } from '@/integrations/gitlab/server/fetch'

/**
 * List projects accessible to the authenticated user.
 */
export async function listGitLabProjects(
  accessToken: string,
  instanceUrl?: string | null
): Promise<Array<{ id: string; name: string }>> {
  const response = await gitlabFetch(
    `${gitlabApiBase(instanceUrl)}/projects?membership=true&order_by=last_activity_at&sort=desc&per_page=100`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to list GitLab projects: HTTP ${response.status}`)
  }

  const projects = (await response.json()) as Array<{
    id: number
    name_with_namespace: string
  }>

  return projects.map((p) => ({
    id: String(p.id),
    name: p.name_with_namespace,
  }))
}

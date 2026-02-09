/**
 * GitLab project listing.
 */

const GITLAB_API = 'https://gitlab.com/api/v4'

/**
 * List projects accessible to the authenticated user.
 */
export async function listGitLabProjects(
  accessToken: string
): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(
    `${GITLAB_API}/projects?membership=true&order_by=last_activity_at&sort=desc&per_page=100`,
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

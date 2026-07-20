/**
 * Asana project listing via REST API.
 */

const ASANA_API = 'https://app.asana.com/api/1.0'

/**
 * List Asana projects in a workspace, filtering out archived ones.
 */
export async function listAsanaProjects(
  accessToken: string,
  workspaceGid: string
): Promise<Array<{ id: string; name: string }>> {
  const params = new URLSearchParams({
    workspace: workspaceGid,
    opt_fields: 'name,archived',
    limit: '100',
  })

  const response = await fetch(`${ASANA_API}/projects?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to list Asana projects: HTTP ${response.status}`)
  }

  const body = (await response.json()) as {
    data?: Array<{ gid: string; name: string; archived: boolean }>
  }

  return (body.data ?? [])
    .filter((project) => !project.archived)
    .map((project) => ({
      id: project.gid,
      name: project.name,
    }))
}

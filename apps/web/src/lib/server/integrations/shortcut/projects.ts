/**
 * Shortcut project listing via REST API.
 */

const SHORTCUT_API = 'https://api.app.shortcut.com/api/v3'

/**
 * List Shortcut projects accessible to the authenticated user.
 */
export async function listShortcutProjects(
  apiToken: string
): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${SHORTCUT_API}/projects`, {
    method: 'GET',
    headers: {
      'Shortcut-Token': apiToken,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to list Shortcut projects: HTTP ${response.status}`)
  }

  const data = (await response.json()) as Array<{ id: number; name: string }>

  return data.map((project) => ({
    id: String(project.id),
    name: project.name,
  }))
}

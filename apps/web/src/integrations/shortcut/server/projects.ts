/**
 * Shortcut group (team) listing via REST API.
 *
 * Shortcut deprecated Projects in favor of Groups (Teams).
 * New workspaces may have no projects, so we use /groups.
 * See: https://developer.shortcut.com/api/rest/v3#Groups
 */

const SHORTCUT_API = 'https://api.app.shortcut.com/api/v3'

/**
 * List Shortcut groups (teams) accessible to the authenticated user.
 */
export async function listShortcutProjects(
  apiToken: string
): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${SHORTCUT_API}/groups`, {
    method: 'GET',
    headers: {
      'Shortcut-Token': apiToken,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to list Shortcut groups: HTTP ${response.status}`)
  }

  const data = (await response.json()) as Array<{ id: string; name: string }>

  return data.map((group) => ({
    id: group.id,
    name: group.name,
  }))
}

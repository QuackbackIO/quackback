/**
 * ClickUp space and list listing via REST API.
 */

const CLICKUP_API = 'https://api.clickup.com/api/v2'

/**
 * List ClickUp spaces accessible in a team (workspace).
 */
export async function listClickUpSpaces(
  accessToken: string,
  teamId: string
): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${CLICKUP_API}/team/${teamId}/space`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to list ClickUp spaces: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    spaces?: Array<{ id: string; name: string }>
  }

  return (data.spaces ?? []).map((space) => ({
    id: space.id,
    name: space.name,
  }))
}

/**
 * List ClickUp lists in a space (folderless lists).
 */
export async function listClickUpLists(
  accessToken: string,
  spaceId: string
): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${CLICKUP_API}/space/${spaceId}/list`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to list ClickUp lists: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    lists?: Array<{ id: string; name: string }>
  }

  return (data.lists ?? []).map((list) => ({
    id: list.id,
    name: list.name,
  }))
}

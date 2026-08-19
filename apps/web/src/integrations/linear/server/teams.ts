/**
 * Linear team listing via GraphQL.
 */

const LINEAR_API = 'https://api.linear.app/graphql'

/**
 * List Linear teams accessible to the authenticated user.
 */
export async function listLinearTeams(
  accessToken: string
): Promise<Array<{ id: string; name: string; key: string }>> {
  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: '{ teams { nodes { id name key } } }',
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to list Linear teams: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    data?: { teams?: { nodes: Array<{ id: string; name: string; key: string }> } }
  }

  return (data.data?.teams?.nodes ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    key: team.key,
  }))
}

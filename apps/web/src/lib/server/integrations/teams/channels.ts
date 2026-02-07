/**
 * Teams channel and team listing.
 */

const GRAPH_API = 'https://graph.microsoft.com/v1.0'

interface TeamsTeam {
  id: string
  displayName: string
}

interface TeamsChannel {
  id: string
  displayName: string
  membershipType: string
}

/**
 * List joined teams.
 */
export async function listTeams(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${GRAPH_API}/me/joinedTeams`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to list Teams: HTTP ${response.status}`)
  }

  const data = (await response.json()) as { value: TeamsTeam[] }

  return data.value.map((team) => ({
    id: team.id,
    name: team.displayName,
  }))
}

/**
 * List channels in a team.
 */
export async function listTeamsChannels(
  accessToken: string,
  teamId: string
): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
  const response = await fetch(
    `${GRAPH_API}/teams/${teamId}/channels?$select=id,displayName,membershipType`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to list Teams channels: HTTP ${response.status}`)
  }

  const data = (await response.json()) as { value: TeamsChannel[] }

  return data.value.map((channel) => ({
    id: channel.id,
    name: channel.displayName,
    isPrivate: channel.membershipType === 'private',
  }))
}

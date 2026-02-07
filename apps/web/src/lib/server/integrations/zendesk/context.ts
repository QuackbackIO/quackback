/**
 * Zendesk customer context enrichment.
 */

export interface ZendeskUser {
  id: number
  name: string
  email: string
  organization?: { name: string; id: number }
  tags?: string[]
  role: string
}

/**
 * Search for a Zendesk user by email.
 */
export async function searchZendeskUser(
  accessToken: string,
  subdomain: string,
  email: string
): Promise<ZendeskUser | null> {
  const response = await fetch(
    `https://${subdomain}.zendesk.com/api/v2/users/search.json?query=${encodeURIComponent(email)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )

  if (!response.ok) return null

  const data = (await response.json()) as {
    users?: Array<{
      id: number
      name: string
      email: string
      organization_id?: number
      tags?: string[]
      role: string
    }>
  }

  const user = data.users?.[0]
  if (!user) return null

  // Get organization if present
  let organization: { name: string; id: number } | undefined
  if (user.organization_id) {
    const orgResponse = await fetch(
      `https://${subdomain}.zendesk.com/api/v2/organizations/${user.organization_id}.json`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (orgResponse.ok) {
      const orgData = (await orgResponse.json()) as {
        organization?: { id: number; name: string }
      }
      if (orgData.organization) {
        organization = { name: orgData.organization.name, id: orgData.organization.id }
      }
    }
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    organization,
    tags: user.tags,
    role: user.role,
  }
}

/**
 * Intercom customer context enrichment.
 * Looks up contact data by email to enrich feedback posts.
 */

const INTERCOM_API = 'https://api.intercom.io'

export interface IntercomContact {
  id: string
  name?: string
  email?: string
  company?: { name: string; id: string }
  customAttributes?: Record<string, string | number | boolean | null>
  tags?: string[]
}

/**
 * Search for an Intercom contact by email.
 */
export async function searchContact(
  accessToken: string,
  email: string
): Promise<IntercomContact | null> {
  const response = await fetch(`${INTERCOM_API}/contacts/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Intercom-Version': '2.14',
    },
    body: JSON.stringify({
      query: {
        field: 'email',
        operator: '=',
        value: email,
      },
    }),
  })

  if (!response.ok) return null

  const data = (await response.json()) as {
    data?: Array<{
      id: string
      name?: string
      email?: string
      companies?: { data?: Array<{ name: string; id: string }> }
      custom_attributes?: Record<string, string | number | boolean | null>
      tags?: { data?: Array<{ name: string }> }
    }>
  }

  const contact = data.data?.[0]
  if (!contact) return null

  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    company: contact.companies?.data?.[0]
      ? { name: contact.companies.data[0].name, id: contact.companies.data[0].id }
      : undefined,
    customAttributes: contact.custom_attributes,
    tags: contact.tags?.data?.map((t) => t.name),
  }
}

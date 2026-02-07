/**
 * HubSpot customer context enrichment.
 * Looks up contacts and associated deals for revenue insights.
 */

const HUBSPOT_API = 'https://api.hubapi.com'

export interface HubSpotContact {
  id: string
  email: string
  firstName?: string
  lastName?: string
  company?: string
  lifecycleStage?: string
  totalDealValue?: number
  deals?: Array<{
    id: string
    name: string
    stage: string
    amount?: number
  }>
}

/**
 * Search for a HubSpot contact by email and enrich with deal data.
 */
export async function searchHubSpotContact(
  accessToken: string,
  email: string
): Promise<HubSpotContact | null> {
  // Search for contact
  const searchResponse = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
        },
      ],
      properties: ['email', 'firstname', 'lastname', 'company', 'lifecyclestage'],
    }),
  })

  if (!searchResponse.ok) return null

  const searchData = (await searchResponse.json()) as {
    results?: Array<{
      id: string
      properties: Record<string, string>
    }>
  }

  const contact = searchData.results?.[0]
  if (!contact) return null

  const result: HubSpotContact = {
    id: contact.id,
    email: contact.properties.email,
    firstName: contact.properties.firstname,
    lastName: contact.properties.lastname,
    company: contact.properties.company,
    lifecycleStage: contact.properties.lifecyclestage,
  }

  // Get associated deals
  const dealsResponse = await fetch(
    `${HUBSPOT_API}/crm/v3/objects/contacts/${contact.id}/associations/deals`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (dealsResponse.ok) {
    const dealsData = (await dealsResponse.json()) as {
      results?: Array<{ id: string }>
    }

    if (dealsData.results?.length) {
      const dealIds = dealsData.results.slice(0, 5).map((d) => d.id)
      const deals: HubSpotContact['deals'] = []
      let totalValue = 0

      for (const dealId of dealIds) {
        const dealResponse = await fetch(
          `${HUBSPOT_API}/crm/v3/objects/deals/${dealId}?properties=dealname,dealstage,amount`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
        if (dealResponse.ok) {
          const dealData = (await dealResponse.json()) as {
            id: string
            properties: Record<string, string>
          }
          const amount = parseFloat(dealData.properties.amount) || 0
          totalValue += amount
          deals.push({
            id: dealData.id,
            name: dealData.properties.dealname,
            stage: dealData.properties.dealstage,
            amount: amount || undefined,
          })
        }
      }

      result.deals = deals
      result.totalDealValue = totalValue || undefined
    }
  }

  return result
}

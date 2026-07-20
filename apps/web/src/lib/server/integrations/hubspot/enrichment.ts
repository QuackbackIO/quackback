import type { EnrichmentCard } from '../types'
import { searchHubSpotContact } from './context'

/** IF WO-9: map a HubSpot contact lookup onto the normalized enrichment card. */
export async function hubspotContext(params: {
  accessToken: string
  config: Record<string, unknown>
  email: string
}): Promise<EnrichmentCard | null> {
  const contact = await searchHubSpotContact(params.accessToken, params.email)
  if (!contact) return null

  const fields = []
  if (contact.lifecycleStage) fields.push({ label: 'Lifecycle', value: contact.lifecycleStage })
  if (contact.totalDealValue != null) {
    fields.push({ label: 'Deal value', value: `$${contact.totalDealValue.toLocaleString()}` })
  }
  if (contact.deals?.length) {
    fields.push({ label: 'Open deals', value: String(contact.deals.length) })
  }

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || undefined
  return {
    provider: 'hubspot',
    name,
    company: contact.company,
    url: `https://app.hubspot.com/contacts/contact/${contact.id}`,
    fields,
  }
}

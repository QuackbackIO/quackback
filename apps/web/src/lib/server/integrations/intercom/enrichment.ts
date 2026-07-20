import type { EnrichmentCard } from '../types'
import { searchContact } from './context'

/** IF WO-9: map an Intercom contact lookup onto the normalized enrichment card. */
export async function intercomContext(params: {
  accessToken: string
  config: Record<string, unknown>
  email: string
}): Promise<EnrichmentCard | null> {
  const contact = await searchContact(params.accessToken, params.email)
  if (!contact) return null

  const fields = []
  const plan = contact.customAttributes?.plan
  if (plan != null) fields.push({ label: 'Plan', value: String(plan) })
  if (contact.tags?.length) fields.push({ label: 'Tags', value: contact.tags.join(', ') })

  return {
    provider: 'intercom',
    name: contact.name,
    company: contact.company?.name,
    url: contact.id ? `https://app.intercom.com/a/apps/_/users/${contact.id}` : undefined,
    fields,
  }
}

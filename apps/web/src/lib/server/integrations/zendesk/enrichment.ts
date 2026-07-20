import type { EnrichmentCard } from '../types'
import { searchZendeskUser } from './context'

/** IF WO-9: map a Zendesk user lookup onto the normalized enrichment card. */
export async function zendeskContext(params: {
  accessToken: string
  config: Record<string, unknown>
  email: string
}): Promise<EnrichmentCard | null> {
  const subdomain = params.config.subdomain as string | undefined
  if (!subdomain) return null

  const user = await searchZendeskUser(params.accessToken, subdomain, params.email)
  if (!user) return null

  const fields = []
  if (user.role) fields.push({ label: 'Role', value: user.role })
  if (user.tags?.length) fields.push({ label: 'Tags', value: user.tags.join(', ') })

  return {
    provider: 'zendesk',
    name: user.name,
    company: user.organization?.name,
    url: `https://${subdomain}.zendesk.com/agent/users/${user.id}`,
    fields,
  }
}

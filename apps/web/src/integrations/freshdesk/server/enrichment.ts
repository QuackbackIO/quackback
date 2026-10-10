import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'

export const freshdeskContext: NonNullable<IntegrationDefinition['context']> = async ({
  accessToken,
  config,
  email,
}) => {
  const subdomain = config.subdomain
  if (typeof subdomain !== 'string' || !/^[a-z0-9-]+$/.test(subdomain))
    throw new Error('Invalid Freshdesk subdomain')
  const response = await integrationFetch(
    `https://${subdomain}.freshdesk.com/api/v2/contacts?${new URLSearchParams({ email })}`,
    {
      headers: { Authorization: `Basic ${btoa(`${accessToken}:X`)}` },
    }
  )
  if (!response.ok)
    throw Object.assign(new Error('Freshdesk contact lookup failed'), { status: response.status })
  const contacts = (await response.json()) as Array<{
    id: number
    name?: string
    job_title?: string
  }>
  const contact = contacts[0]
  return contact
    ? {
        provider: 'freshdesk',
        name: contact.name,
        url: `https://${subdomain}.freshdesk.com/a/contacts/${encodeURIComponent(contact.id)}`,
        fields: contact.job_title ? [{ label: 'Job title', value: contact.job_title }] : [],
      }
    : null
}

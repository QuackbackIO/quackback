import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'

export const salesforceContext: NonNullable<IntegrationDefinition['context']> = async ({
  accessToken,
  config,
  email,
}) => {
  const instance = new URL(String(config.instanceUrl))
  if (
    instance.protocol !== 'https:' ||
    !instance.hostname.endsWith('.salesforce.com') ||
    instance.username ||
    instance.password ||
    instance.port
  )
    throw new Error('Invalid Salesforce instance')
  const safeEmail = email.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const query = `SELECT Id, Name, Account.Name FROM Contact WHERE Email = '${safeEmail}' LIMIT 1`
  const response = await integrationFetch(
    `${instance.origin}/services/data/v62.0/query?${new URLSearchParams({ q: query })}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )
  if (!response.ok)
    throw Object.assign(new Error('Salesforce contact lookup failed'), { status: response.status })
  const data = (await response.json()) as {
    records: Array<{ Id: string; Name: string; Account?: { Name: string } }>
  }
  const contact = data.records[0]
  return contact
    ? {
        provider: 'salesforce',
        name: contact.Name,
        company: contact.Account?.Name,
        url: `${instance.origin}/lightning/r/Contact/${encodeURIComponent(contact.Id)}/view`,
        fields: [],
      }
    : null
}

import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'

export const stripeContext: NonNullable<IntegrationDefinition['context']> = async ({
  accessToken,
  email,
}) => {
  const query = new URLSearchParams({ email, limit: '1' })
  const response = await integrationFetch(`https://api.stripe.com/v1/customers?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok)
    throw Object.assign(new Error('Stripe customer lookup failed'), { status: response.status })
  const data = (await response.json()) as {
    data: Array<{ id: string; name?: string; email?: string }>
  }
  const customer = data.data[0]
  return customer
    ? {
        provider: 'stripe',
        name: customer.name,
        url: `https://dashboard.stripe.com/customers/${encodeURIComponent(customer.id)}`,
        fields: [{ label: 'Customer ID', value: customer.id }],
      }
    : null
}

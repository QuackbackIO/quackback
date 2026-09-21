import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { stripeContext } from '@/integrations/stripe/server/enrichment'
import { stripeCatalog } from '@/integrations/stripe/server/catalog'

export const stripeIntegration: IntegrationDefinition = {
  id: 'stripe',
  catalog: stripeCatalog,
  // No OAuth — Stripe uses API keys pasted by the admin
  context: stripeContext,
  platformCredentials: [],
}

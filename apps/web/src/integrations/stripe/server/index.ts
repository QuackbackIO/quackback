import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { stripeHook } from '@/integrations/stripe/server/hook'
import { stripeCatalog } from '@/integrations/stripe/server/catalog'

export const stripeIntegration: IntegrationDefinition = {
  id: 'stripe',
  catalog: stripeCatalog,
  // No OAuth — Stripe uses API keys pasted by the admin
  hook: stripeHook,
  platformCredentials: [],
}

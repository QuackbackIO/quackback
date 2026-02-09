import type { IntegrationDefinition } from '../types'
import { stripeHook } from './hook'
import { stripeCatalog } from './catalog'

export const stripeIntegration: IntegrationDefinition = {
  id: 'stripe',
  catalog: stripeCatalog,
  // No OAuth — Stripe uses API keys pasted by the admin
  hook: stripeHook,
  platformCredentials: [],
}

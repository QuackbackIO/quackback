import type { IntegrationDefinition } from '../types'
import { freshdeskHook } from './hook'
import { freshdeskCatalog } from './catalog'

export const freshdeskIntegration: IntegrationDefinition = {
  id: 'freshdesk',
  catalog: freshdeskCatalog,
  // No OAuth — Freshdesk uses API key + subdomain
  hook: freshdeskHook,
  platformCredentials: [],
}

import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { freshdeskHook } from '@/integrations/freshdesk/server/hook'
import { freshdeskCatalog } from '@/integrations/freshdesk/server/catalog'

export const freshdeskIntegration: IntegrationDefinition = {
  id: 'freshdesk',
  catalog: freshdeskCatalog,
  // No OAuth — Freshdesk uses API key + subdomain
  hook: freshdeskHook,
  platformCredentials: [],
}

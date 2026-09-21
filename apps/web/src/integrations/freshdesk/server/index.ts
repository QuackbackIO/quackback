import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { freshdeskContext } from '@/integrations/freshdesk/server/enrichment'
import { freshdeskCatalog } from '@/integrations/freshdesk/server/catalog'

export const freshdeskIntegration: IntegrationDefinition = {
  id: 'freshdesk',
  catalog: freshdeskCatalog,
  // No OAuth — Freshdesk uses API key + subdomain
  context: freshdeskContext,
  platformCredentials: [],
}

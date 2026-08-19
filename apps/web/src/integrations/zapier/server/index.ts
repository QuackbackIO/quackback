import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { zapierHook } from '@/integrations/zapier/server/hook'
import { zapierCatalog } from '@/integrations/zapier/server/catalog'

export const zapierIntegration: IntegrationDefinition = {
  id: 'zapier',
  catalog: zapierCatalog,
  // No OAuth — Zapier uses webhook URLs pasted by the user
  hook: zapierHook,
  platformCredentials: [],
}

import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { n8nHook } from '@/integrations/n8n/server/hook'
import { n8nCatalog } from '@/integrations/n8n/server/catalog'

export const n8nIntegration: IntegrationDefinition = {
  id: 'n8n',
  destination: { scopeKeys: [] },
  catalog: n8nCatalog,
  hook: n8nHook,
  platformCredentials: [],
}

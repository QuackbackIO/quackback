import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { ntfyHook } from '@/integrations/ntfy/server/hook'
import { ntfyCatalog } from '@/integrations/ntfy/server/catalog'

export const ntfyIntegration: IntegrationDefinition = {
  id: 'ntfy',
  destination: { scopeKeys: ['apiUrl'] },
  catalog: ntfyCatalog,
  hook: ntfyHook,
  platformCredentials: [],
}

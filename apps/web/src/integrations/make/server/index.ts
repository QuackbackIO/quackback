import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { makeHook } from '@/integrations/make/server/hook'
import { makeCatalog } from '@/integrations/make/server/catalog'

export const makeIntegration: IntegrationDefinition = {
  id: 'make',
  destination: { scopeKeys: [] },
  catalog: makeCatalog,
  hook: makeHook,
  platformCredentials: [],
}

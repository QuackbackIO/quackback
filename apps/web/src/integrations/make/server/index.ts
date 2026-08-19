import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { makeHook } from '@/integrations/make/server/hook'
import { makeCatalog } from '@/integrations/make/server/catalog'

export const makeIntegration: IntegrationDefinition = {
  id: 'make',
  catalog: makeCatalog,
  hook: makeHook,
  platformCredentials: [],
}

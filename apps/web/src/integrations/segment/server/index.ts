import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { segmentCatalog } from '@/integrations/segment/server/catalog'
import { segmentUserSync } from '@/integrations/segment/server/user-sync'

export const segmentIntegration: IntegrationDefinition = {
  id: 'segment',
  catalog: segmentCatalog,
  // No OAuth — connected by manually entering a write key + shared secret via admin UI
  userSync: segmentUserSync,
  platformCredentials: [],
}

import type { IntegrationDefinition } from '../types'
import { segmentCatalog } from './catalog'
import { segmentUserSync } from './user-sync'

export const segmentIntegration: IntegrationDefinition = {
  id: 'segment',
  catalog: segmentCatalog,
  // No OAuth — connected by manually entering a write key + shared secret via admin UI
  userSync: segmentUserSync,
  platformCredentials: [],
}

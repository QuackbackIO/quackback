import type { IntegrationDefinition } from '../types'
import { n8nHook } from './hook'
import { n8nCatalog } from './catalog'

export const n8nIntegration: IntegrationDefinition = {
  id: 'n8n',
  catalog: n8nCatalog,
  hook: n8nHook,
  platformCredentials: [],
}

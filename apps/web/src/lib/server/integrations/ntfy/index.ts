import type { IntegrationDefinition } from '../types'
import { ntfyHook } from './hook'
import { ntfyCatalog } from './catalog'

export const ntfyIntegration: IntegrationDefinition = {
  id: 'ntfy',
  catalog: ntfyCatalog,
  hook: ntfyHook,
  platformCredentials: [],
}

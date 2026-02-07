import type { IntegrationDefinition } from '../types'
import { zapierHook } from './hook'
import { zapierCatalog } from './catalog'

export const zapierIntegration: IntegrationDefinition = {
  id: 'zapier',
  catalog: zapierCatalog,
  // No OAuth — Zapier uses webhook URLs pasted by the user
  hook: zapierHook,
  platformCredentials: [],
}

import type { IntegrationDefinition } from '../types'
import { shortcutHook } from './hook'
import { shortcutCatalog } from './catalog'

export const shortcutIntegration: IntegrationDefinition = {
  id: 'shortcut',
  catalog: shortcutCatalog,
  hook: shortcutHook,
  requiredEnvVars: [],
}

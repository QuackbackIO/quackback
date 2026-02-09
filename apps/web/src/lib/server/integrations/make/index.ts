import type { IntegrationDefinition } from '../types'
import { makeHook } from './hook'
import { makeCatalog } from './catalog'

export const makeIntegration: IntegrationDefinition = {
  id: 'make',
  catalog: makeCatalog,
  hook: makeHook,
  platformCredentials: [],
}

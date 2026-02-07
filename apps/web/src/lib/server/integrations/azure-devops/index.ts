import type { IntegrationDefinition } from '../types'
import { azureDevOpsHook } from './hook'
import { azureDevOpsCatalog } from './catalog'

export const azureDevOpsIntegration: IntegrationDefinition = {
  id: 'azure_devops',
  catalog: azureDevOpsCatalog,
  // No OAuth — Azure DevOps uses Personal Access Tokens
  hook: azureDevOpsHook,
  platformCredentials: [],
}

import type { IntegrationCatalogEntry } from '../types'

export const azureDevOpsCatalog: IntegrationCatalogEntry = {
  id: 'azure_devops',
  name: 'Azure DevOps',
  description: 'Create and link Azure DevOps work items from feedback posts.',
  category: 'issue_tracking',
  capabilities: [
    {
      label: 'Create work items',
      description: 'Automatically create Azure DevOps work items when new feedback is submitted',
    },
    {
      label: 'Link posts to work items',
      description: 'Link feedback posts to Azure DevOps work items for traceability',
    },
  ],
  iconBg: 'bg-[#0078D4]',
  settingsPath: '/admin/settings/integrations/azure-devops',
  available: true,
  configurable: false,
}

import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const azureDevOpsCatalog: IntegrationCatalogEntry = {
  id: 'azure_devops',
  name: 'Azure DevOps',
  description: 'Create and link Azure DevOps work items from feedback posts.',
  category: 'issue_tracking',
  iconBg: 'bg-[#0078D4]',
  settingsPath: '/admin/settings/integrations/azure-devops',
  available: true,
  configurable: false,
  docsUrl: 'https://www.quackback.io/docs/integrations/azure-devops',
}

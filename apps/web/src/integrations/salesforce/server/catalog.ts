import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const salesforceCatalog: IntegrationCatalogEntry = {
  id: 'salesforce',
  name: 'Salesforce',
  description: 'Enrich feedback with CRM data and create cases from Salesforce.',
  category: 'support_crm',
  iconBg: 'bg-[#00A1E0]',
  settingsPath: '/admin/settings/integrations/salesforce',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/salesforce',
}

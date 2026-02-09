import type { IntegrationCatalogEntry } from '../types'

export const salesforceCatalog: IntegrationCatalogEntry = {
  id: 'salesforce',
  name: 'Salesforce',
  description: 'Enrich feedback with CRM data and create cases from Salesforce.',
  category: 'support_crm',
  capabilities: [
    {
      label: 'Account enrichment',
      description: 'See account name, opportunity stage, and deal value alongside feedback',
    },
    {
      label: 'Contact lookup',
      description: 'Automatically match feedback authors to Salesforce contacts by email address',
    },
    {
      label: 'Case creation',
      description: 'Create Salesforce cases from feedback posts for tracking in your CRM',
    },
  ],
  iconBg: 'bg-[#00A1E0]',
  settingsPath: '/admin/settings/integrations/salesforce',
  available: true,
  configurable: true,
}

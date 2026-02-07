import type { IntegrationCatalogEntry } from '../types'

export const hubspotCatalog: IntegrationCatalogEntry = {
  id: 'hubspot',
  name: 'HubSpot',
  description: 'Enrich feedback with HubSpot contact data and deal value.',
  category: 'support_crm',
  capabilities: [
    {
      label: 'Customer context',
      description:
        'Enrich feedback with HubSpot contact data like company, deal value, and lifecycle stage',
    },
    {
      label: 'Revenue insights',
      description:
        'See the revenue impact of feature requests by linking feedback to deal pipeline data',
    },
  ],
  iconBg: 'bg-[#FF7A59]',
  settingsPath: '/admin/settings/integrations/hubspot',
  available: true,
  configurable: true,
}

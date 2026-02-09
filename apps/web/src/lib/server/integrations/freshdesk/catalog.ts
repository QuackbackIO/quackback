import type { IntegrationCatalogEntry } from '../types'

export const freshdeskCatalog: IntegrationCatalogEntry = {
  id: 'freshdesk',
  name: 'Freshdesk',
  description: 'Enrich feedback with support ticket data from Freshdesk.',
  category: 'support_crm',
  capabilities: [
    {
      label: 'Ticket enrichment',
      description:
        'Automatically match feedback authors to Freshdesk contacts and display their support history',
    },
    {
      label: 'Contact lookup',
      description:
        'Look up contacts by email to see open tickets, satisfaction scores, and account details',
    },
  ],
  iconBg: 'bg-[#25C16F]',
  settingsPath: '/admin/settings/integrations/freshdesk',
  available: true,
  configurable: true,
}

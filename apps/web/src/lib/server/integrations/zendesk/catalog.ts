import type { IntegrationCatalogEntry } from '../types'

export const zendeskCatalog: IntegrationCatalogEntry = {
  id: 'zendesk',
  name: 'Zendesk',
  description: 'Link Zendesk tickets to feedback posts and surface customer context.',
  category: 'support_crm',
  capabilities: [
    {
      label: 'Capture feedback',
      description: 'Turn Zendesk tickets into feedback posts directly from the agent interface',
    },
    {
      label: 'Customer context',
      description:
        'Enrich feedback with Zendesk user data like organization, tags, and ticket history',
    },
  ],
  iconBg: 'bg-[#03363D]',
  settingsPath: '/admin/settings/integrations/zendesk',
  available: true,
}

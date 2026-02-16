import type { IntegrationCatalogEntry } from '../types'

export const trelloCatalog: IntegrationCatalogEntry = {
  id: 'trello',
  name: 'Trello',
  description: 'Create cards in Trello from feedback and sync statuses.',
  category: 'issue_tracking',
  capabilities: [
    {
      label: 'Create cards',
      description: 'Automatically create Trello cards when new feedback is submitted',
    },
    {
      label: 'Two-way status sync',
      description: 'Moving cards between lists in Trello updates the feedback status in Quackback',
    },
    {
      label: 'Rich descriptions',
      description:
        'Cards include feedback details, author info, and direct links back to your portal',
    },
  ],
  iconBg: 'bg-[#0052CC]',
  settingsPath: '/admin/settings/integrations/trello',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/trello',
}

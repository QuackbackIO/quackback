import type { IntegrationCatalogEntry } from '../types'

export const notionCatalog: IntegrationCatalogEntry = {
  id: 'notion',
  name: 'Notion',
  description: 'Create database items in Notion from feedback and sync statuses.',
  category: 'issue_tracking',
  capabilities: [
    {
      label: 'Create database items',
      description: 'Automatically create items in a Notion database when new feedback is submitted',
    },
    {
      label: 'Two-way status sync',
      description:
        'Keep feedback statuses in sync — changes in Notion update Quackback and vice versa',
    },
    {
      label: 'Rich content',
      description:
        'Feedback details, author info, and direct links are included in the Notion page',
    },
  ],
  iconBg: 'bg-[#000000]',
  settingsPath: '/admin/settings/integrations/notion',
  available: true,
  configurable: true,
}

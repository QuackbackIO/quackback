import type { IntegrationCatalogEntry } from '../types'

export const shortcutCatalog: IntegrationCatalogEntry = {
  id: 'shortcut',
  name: 'Shortcut',
  description: 'Create Shortcut stories from feedback and sync status changes.',
  category: 'issue_tracking',
  capabilities: [
    {
      label: 'Create stories',
      description: 'Create a Shortcut story from a feedback post in a chosen team',
    },
    {
      label: 'Link posts to stories',
      description: 'Link existing Shortcut stories to feedback posts for traceability',
    },
    {
      label: 'Sync statuses',
      description: 'Keep feedback post status and Shortcut story state in sync',
    },
  ],
  iconBg: 'bg-[#58B1E4]',
  settingsPath: '/admin/settings/integrations/shortcut',
  available: true,
  configurable: false,
  docsUrl: 'https://www.quackback.io/docs/integrations/shortcut',
}

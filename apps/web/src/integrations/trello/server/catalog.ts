import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const trelloCatalog: IntegrationCatalogEntry = {
  id: 'trello',
  name: 'Trello',
  description: 'Create cards in Trello from feedback and sync statuses.',
  category: 'issue_tracking',
  iconBg: 'bg-[#0052CC]',
  settingsPath: '/admin/settings/integrations/trello',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/trello',
}

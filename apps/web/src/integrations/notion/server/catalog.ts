import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const notionCatalog: IntegrationCatalogEntry = {
  id: 'notion',
  name: 'Notion',
  description: 'Create database items in Notion from feedback and sync statuses.',
  category: 'issue_tracking',
  iconBg: 'bg-[#000000]',
  settingsPath: '/admin/settings/integrations/notion',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/notion',
}

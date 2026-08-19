import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const teamsCatalog: IntegrationCatalogEntry = {
  id: 'teams',
  name: 'Microsoft Teams',
  description: 'Post adaptive cards to your Teams channels when events occur.',
  category: 'notifications',
  iconBg: 'bg-[#6264A7]',
  settingsPath: '/admin/settings/integrations/teams',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/teams',
}

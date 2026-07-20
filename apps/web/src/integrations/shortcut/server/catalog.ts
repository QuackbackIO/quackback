import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const shortcutCatalog: IntegrationCatalogEntry = {
  id: 'shortcut',
  name: 'Shortcut',
  description: 'Create Shortcut stories from feedback and sync status changes.',
  category: 'issue_tracking',
  iconBg: 'bg-[#58B1E4]',
  settingsPath: '/admin/settings/integrations/shortcut',
  available: true,
  configurable: false,
  docsUrl: 'https://www.quackback.io/docs/integrations/shortcut',
}

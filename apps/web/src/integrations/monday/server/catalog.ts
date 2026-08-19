import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const mondayCatalog: IntegrationCatalogEntry = {
  id: 'monday',
  name: 'Monday.com',
  description: 'Create items in Monday.com from feedback and sync statuses.',
  category: 'issue_tracking',
  iconBg: 'bg-[#FF3D57]',
  settingsPath: '/admin/settings/integrations/monday',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/monday',
}

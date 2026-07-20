import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const asanaCatalog: IntegrationCatalogEntry = {
  id: 'asana',
  name: 'Asana',
  description: 'Create Asana tasks from feedback and keep status in sync.',
  category: 'issue_tracking',
  iconBg: 'bg-[#F06A6A]',
  settingsPath: '/admin/settings/integrations/asana',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/asana',
}

import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const linearCatalog: IntegrationCatalogEntry = {
  id: 'linear',
  name: 'Linear',
  description: 'Create Linear issues from feedback and keep statuses in sync.',
  category: 'issue_tracking',
  iconBg: 'bg-[#5E6AD2]',
  settingsPath: '/admin/settings/integrations/linear',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/linear',
}

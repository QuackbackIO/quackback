import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const clickupCatalog: IntegrationCatalogEntry = {
  id: 'clickup',
  name: 'ClickUp',
  description: 'Turn feedback into ClickUp tasks and track progress.',
  category: 'issue_tracking',
  iconBg: 'bg-[#7B68EE]',
  settingsPath: '/admin/settings/integrations/clickup',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/clickup',
}

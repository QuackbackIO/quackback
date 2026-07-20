import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const jiraCatalog: IntegrationCatalogEntry = {
  id: 'jira',
  name: 'Jira',
  description: 'Create and sync Jira issues from feedback posts.',
  category: 'issue_tracking',
  iconBg: 'bg-[#0052CC]',
  settingsPath: '/admin/settings/integrations/jira',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/jira',
}

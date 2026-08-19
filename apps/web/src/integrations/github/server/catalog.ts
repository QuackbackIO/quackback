import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const githubCatalog: IntegrationCatalogEntry = {
  id: 'github',
  name: 'GitHub',
  description: 'Create GitHub issues from feedback and sync status updates.',
  category: 'issue_tracking',
  iconBg: 'bg-[#24292F]',
  settingsPath: '/admin/settings/integrations/github',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/github',
}

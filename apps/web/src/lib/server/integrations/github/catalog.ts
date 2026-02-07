import type { IntegrationCatalogEntry } from '../types'

export const githubCatalog: IntegrationCatalogEntry = {
  id: 'github',
  name: 'GitHub',
  description: 'Create GitHub issues from feedback and sync status updates.',
  category: 'issue_tracking',
  capabilities: [
    {
      label: 'Create issues',
      description: 'Create a GitHub issue from a feedback post in a chosen repository',
    },
    {
      label: 'Link posts to issues',
      description: 'Link existing GitHub issues to feedback posts for traceability',
    },
    {
      label: 'Sync statuses',
      description: 'Update feedback status when GitHub issues are closed or reopened',
    },
  ],
  iconBg: 'bg-[#24292F]',
  settingsPath: '/admin/settings/integrations/github',
  available: true,
}

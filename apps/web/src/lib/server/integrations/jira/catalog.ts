import type { IntegrationCatalogEntry } from '../types'

export const jiraCatalog: IntegrationCatalogEntry = {
  id: 'jira',
  name: 'Jira',
  description: 'Create and sync Jira issues from feedback posts.',
  category: 'issue_tracking',
  capabilities: [
    {
      label: 'Create issues',
      description:
        'Create a Jira issue from a feedback post with configurable project and issue type',
    },
    {
      label: 'Link posts to issues',
      description: 'Link existing Jira issues to feedback posts for traceability',
    },
    {
      label: 'Sync statuses',
      description: 'Map Jira workflow statuses to feedback post statuses and keep them in sync',
    },
  ],
  iconBg: 'bg-[#0052CC]',
  settingsPath: '/admin/settings/integrations/jira',
  available: true,
}

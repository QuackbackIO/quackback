import type { IntegrationCatalogEntry } from '../types'

export const gitlabCatalog: IntegrationCatalogEntry = {
  id: 'gitlab',
  name: 'GitLab',
  description: 'Create issues in GitLab from feedback and sync statuses.',
  category: 'issue_tracking',
  capabilities: [
    {
      label: 'Create issues',
      description: 'Automatically create GitLab issues when new feedback is submitted',
    },
    {
      label: 'Two-way status sync',
      description: 'Closing or reopening issues in GitLab updates the feedback status in Quackback',
    },
    {
      label: 'Rich descriptions',
      description:
        'Issues include feedback details, author info, and direct links back to your portal',
    },
  ],
  iconBg: 'bg-[#FC6D26]',
  settingsPath: '/admin/settings/integrations/gitlab',
  available: true,
  configurable: true,
}

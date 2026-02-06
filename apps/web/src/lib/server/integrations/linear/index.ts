import type { IntegrationDefinition } from '../types'

export const linearIntegration: IntegrationDefinition = {
  id: 'linear',
  catalog: {
    id: 'linear',
    name: 'Linear',
    description: 'Sync feedback with Linear issues for seamless project management.',
    category: 'issue_tracking',
    capabilities: [
      {
        label: 'Create issues',
        description: 'Create a Linear issue from a feedback post with one click',
      },
      {
        label: 'Link posts to issues',
        description: 'Link existing Linear issues to feedback posts for traceability',
      },
      {
        label: 'Sync statuses',
        description: 'Keep feedback post status and Linear issue status in sync automatically',
      },
    ],
    iconBg: 'bg-[#5E6AD2]',
    settingsPath: '/admin/settings/integrations/linear',
    available: false,
  },
}

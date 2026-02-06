import type { IntegrationDefinition } from '../types'

export const asanaIntegration: IntegrationDefinition = {
  id: 'asana',
  catalog: {
    id: 'asana',
    name: 'Asana',
    description: 'Create Asana tasks from feedback and keep status in sync.',
    category: 'issue_tracking',
    capabilities: [
      {
        label: 'Create tasks',
        description: 'Create an Asana task from a feedback post in a chosen project',
      },
      {
        label: 'Link posts to tasks',
        description: 'Link existing Asana tasks to feedback posts for traceability',
      },
      {
        label: 'Sync statuses',
        description: 'Keep feedback post status and Asana task status in sync',
      },
    ],
    iconBg: 'bg-[#F06A6A]',
    settingsPath: '/admin/settings/integrations/asana',
    available: false,
  },
}

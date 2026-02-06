import type { IntegrationDefinition } from '../types'

export const clickupIntegration: IntegrationDefinition = {
  id: 'clickup',
  catalog: {
    id: 'clickup',
    name: 'ClickUp',
    description: 'Turn feedback into ClickUp tasks and track progress.',
    category: 'issue_tracking',
    capabilities: [
      {
        label: 'Create tasks',
        description: 'Create a ClickUp task from a feedback post in a chosen list',
      },
      {
        label: 'Link posts to tasks',
        description: 'Link existing ClickUp tasks to feedback posts for traceability',
      },
      {
        label: 'Sync statuses',
        description: 'Keep feedback post status and ClickUp task status in sync',
      },
    ],
    iconBg: 'bg-[#7B68EE]',
    settingsPath: '/admin/settings/integrations/clickup',
    available: false,
  },
}

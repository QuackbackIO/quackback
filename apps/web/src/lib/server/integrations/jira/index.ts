import type { IntegrationDefinition } from '../types'

export const jiraIntegration: IntegrationDefinition = {
  id: 'jira',
  catalog: {
    id: 'jira',
    name: 'Jira',
    description: 'Create and sync Jira issues from feedback posts.',
    iconBg: 'bg-[#0052CC]',
    settingsPath: '/admin/settings/integrations/jira',
    available: false,
  },
}

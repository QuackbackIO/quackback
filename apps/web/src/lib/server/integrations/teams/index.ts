import type { IntegrationDefinition } from '../types'

export const teamsIntegration: IntegrationDefinition = {
  id: 'teams',
  catalog: {
    id: 'teams',
    name: 'Microsoft Teams',
    description: 'Post feedback notifications to Microsoft Teams channels.',
    category: 'notifications',
    capabilities: [
      {
        label: 'Channel notifications',
        description:
          'Post adaptive cards to a Teams channel when feedback is submitted, statuses change, or comments are added',
      },
      {
        label: 'Actionable cards',
        description: 'Cards include post details and a link to view feedback in the portal',
      },
    ],
    iconBg: 'bg-[#6264A7]',
    settingsPath: '/admin/settings/integrations/teams',
    available: false,
  },
}

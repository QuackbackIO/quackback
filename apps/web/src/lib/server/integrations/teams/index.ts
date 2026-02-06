import type { IntegrationDefinition } from '../types'

export const teamsIntegration: IntegrationDefinition = {
  id: 'teams',
  catalog: {
    id: 'teams',
    name: 'Microsoft Teams',
    description: 'Post feedback notifications to Microsoft Teams channels.',
    iconBg: 'bg-[#6264A7]',
    settingsPath: '/admin/settings/integrations/teams',
    available: false,
  },
}

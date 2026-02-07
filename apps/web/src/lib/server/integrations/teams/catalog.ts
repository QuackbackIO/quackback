import type { IntegrationCatalogEntry } from '../types'

export const teamsCatalog: IntegrationCatalogEntry = {
  id: 'teams',
  name: 'Microsoft Teams',
  description: 'Post adaptive cards to your Teams channels when events occur.',
  category: 'notifications',
  capabilities: [
    {
      label: 'Channel notifications',
      description:
        'Post adaptive cards to a Teams channel when feedback is submitted, statuses change, or comments are added',
    },
    {
      label: 'Actionable cards',
      description: 'Cards include post details and direct links back to your feedback portal',
    },
  ],
  iconBg: 'bg-[#6264A7]',
  settingsPath: '/admin/settings/integrations/teams',
  available: true,
}

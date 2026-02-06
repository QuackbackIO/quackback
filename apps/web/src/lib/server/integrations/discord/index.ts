import type { IntegrationDefinition } from '../types'

export const discordIntegration: IntegrationDefinition = {
  id: 'discord',
  catalog: {
    id: 'discord',
    name: 'Discord',
    description: 'Send notifications to your Discord server channels.',
    category: 'notifications',
    capabilities: [
      {
        label: 'Channel notifications',
        description:
          'Post messages to a Discord channel when feedback is submitted, statuses change, or comments are added',
      },
      {
        label: 'Rich embeds',
        description: 'Messages use Discord embeds with post details and direct links',
      },
    ],
    iconBg: 'bg-[#5865F2]',
    settingsPath: '/admin/settings/integrations/discord',
    available: false,
  },
}

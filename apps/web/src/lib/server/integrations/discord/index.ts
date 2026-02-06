import type { IntegrationDefinition } from '../types'

export const discordIntegration: IntegrationDefinition = {
  id: 'discord',
  catalog: {
    id: 'discord',
    name: 'Discord',
    description: 'Send notifications to your Discord server channels.',
    iconBg: 'bg-[#5865F2]',
    settingsPath: '/admin/settings/integrations/discord',
    available: false,
  },
}

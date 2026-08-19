import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const discordCatalog: IntegrationCatalogEntry = {
  id: 'discord',
  name: 'Discord',
  description: 'Send notifications to your Discord server channels.',
  category: 'notifications',
  iconBg: 'bg-[#5865F2]',
  settingsPath: '/admin/settings/integrations/discord',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/discord',
}

import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const slackCatalog: IntegrationCatalogEntry = {
  id: 'slack',
  name: 'Slack',
  description:
    'Send feedback from Slack to Quackback with a message shortcut, monitor channels for automatic feedback ingestion, and get notified when statuses change or comments are added.',
  category: 'notifications',
  iconBg: 'bg-[#4A154B]',
  settingsPath: '/admin/settings/integrations/slack',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/slack',
}

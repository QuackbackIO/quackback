import type { IntegrationCatalogEntry } from '../types'

export const slackCatalog: IntegrationCatalogEntry = {
  id: 'slack',
  name: 'Slack',
  description:
    'Get notified in Slack when users submit feedback, statuses change, or comments are added.',
  category: 'notifications',
  capabilities: [
    {
      label: 'Channel notifications',
      description:
        'Post messages to a Slack channel when feedback is submitted, statuses change, or comments are added',
    },
    {
      label: 'Rich message formatting',
      description:
        'Messages include feedback title, author, status changes, and a direct link back to your portal',
    },
  ],
  iconBg: 'bg-[#4A154B]',
  settingsPath: '/admin/settings/integrations/slack',
  available: true,
}

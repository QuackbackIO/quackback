import type { IntegrationCatalogEntry } from '../types'

export const ntfyCatalog: IntegrationCatalogEntry = {
  id: 'ntfy',
  name: 'ntfy',
  description:
    'Send push notifications to ntfy.sh or your self-hosted ntfy server when feedback events occur.',
  category: 'notifications',
  capabilities: [
    {
      label: 'Push notifications',
      description:
        'Receive instant push notifications on any device when feedback is submitted, statuses change, or comments are added',
    },
    {
      label: 'Works with ntfy.sh or self-hosted',
      description:
        'Use the free ntfy.sh service or point to your own ntfy instance with an optional access token',
    },
  ],
  iconBg: 'bg-[#317f6f]',
  settingsPath: '/admin/settings/integrations/ntfy',
  available: true,
  configurable: false,
  docsUrl: 'https://www.quackback.io/docs/integrations/ntfy',
}

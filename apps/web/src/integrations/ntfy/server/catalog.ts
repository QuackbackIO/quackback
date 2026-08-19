import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const ntfyCatalog: IntegrationCatalogEntry = {
  id: 'ntfy',
  name: 'ntfy',
  description:
    'Send push notifications to ntfy.sh or your self-hosted ntfy server when feedback events occur.',
  category: 'notifications',
  iconBg: 'bg-[#317f6f]',
  settingsPath: '/admin/settings/integrations/ntfy',
  available: true,
  configurable: false,
  docsUrl: 'https://www.quackback.io/docs/integrations/ntfy',
}

import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const freshdeskCatalog: IntegrationCatalogEntry = {
  id: 'freshdesk',
  name: 'Freshdesk',
  description: 'Enrich feedback with support ticket data from Freshdesk.',
  category: 'support_crm',
  iconBg: 'bg-[#25C16F]',
  settingsPath: '/admin/settings/integrations/freshdesk',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/freshdesk',
}

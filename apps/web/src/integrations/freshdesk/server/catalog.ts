import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const freshdeskCatalog: IntegrationCatalogEntry = {
  id: 'freshdesk',
  name: 'Freshdesk',
  description: 'Look up customer contact details and Freshdesk profiles.',
  category: 'support_crm',
  iconBg: 'bg-[#25C16F]',
  settingsPath: '/admin/settings/integrations/freshdesk',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/freshdesk',
}

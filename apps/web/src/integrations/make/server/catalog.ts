import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const makeCatalog: IntegrationCatalogEntry = {
  id: 'make',
  name: 'Make',
  description: 'Connect Quackback to Make (formerly Integromat) automation scenarios.',
  category: 'automation',
  iconBg: 'bg-[#6D00CC]',
  settingsPath: '/admin/settings/integrations/make',
  available: true,
  configurable: false,
  docsUrl: 'https://www.quackback.io/docs/integrations/make',
}

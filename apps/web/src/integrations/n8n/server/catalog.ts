import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const n8nCatalog: IntegrationCatalogEntry = {
  id: 'n8n',
  name: 'n8n',
  description: 'Connect Quackback to your self-hosted n8n automation workflows.',
  category: 'automation',
  iconBg: 'bg-[#EA4B71]',
  settingsPath: '/admin/settings/integrations/n8n',
  available: true,
  configurable: false,
  docsUrl: 'https://www.quackback.io/docs/integrations/n8n',
}

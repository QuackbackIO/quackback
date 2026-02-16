import type { IntegrationCatalogEntry } from '../types'

export const n8nCatalog: IntegrationCatalogEntry = {
  id: 'n8n',
  name: 'n8n',
  description: 'Connect Quackback to your self-hosted n8n automation workflows.',
  category: 'automation',
  capabilities: [
    {
      label: 'Trigger workflows',
      description:
        'Trigger n8n workflows when feedback is submitted, statuses change, or comments are added',
    },
    {
      label: 'Self-hosted automation',
      description: 'Keep your automation pipelines on your own infrastructure with full control',
    },
  ],
  iconBg: 'bg-[#EA4B71]',
  settingsPath: '/admin/settings/integrations/n8n',
  available: true,
  configurable: false,
  docsUrl: 'https://www.quackback.io/docs/integrations/n8n',
}

import type { IntegrationCatalogEntry } from '../types'

export const intercomCatalog: IntegrationCatalogEntry = {
  id: 'intercom',
  name: 'Intercom',
  description: 'Push feedback from Intercom conversations and sync customer data.',
  category: 'support_crm',
  capabilities: [
    {
      label: 'Capture feedback',
      description: 'Turn Intercom conversations into feedback posts without leaving your inbox',
    },
    {
      label: 'Customer context',
      description:
        'Enrich feedback with Intercom contact data like plan, company, and conversation history',
    },
  ],
  iconBg: 'bg-[#1F8DED]',
  settingsPath: '/admin/settings/integrations/intercom',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/intercom',
}

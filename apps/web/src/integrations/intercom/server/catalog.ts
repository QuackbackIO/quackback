import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const intercomCatalog: IntegrationCatalogEntry = {
  id: 'intercom',
  name: 'Intercom',
  description: 'Show Intercom contact details, such as plan and company, next to feedback.',
  category: 'support_crm',
  capabilities: [
    {
      label: 'Customer context',
      description: 'Look up Intercom contact details like plan, company, and tags by email',
    },
  ],
  iconBg: 'bg-[#1F8DED]',
  settingsPath: '/admin/settings/integrations/intercom',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/intercom',
}

import type { IntegrationCatalogEntry } from '../types'

export const zapierCatalog: IntegrationCatalogEntry = {
  id: 'zapier',
  name: 'Zapier',
  description: 'Connect Quackback to 6,000+ apps with Zapier automations.',
  category: 'automation',
  capabilities: [
    {
      label: 'Trigger workflows',
      description:
        'Trigger a Zap when feedback is submitted, statuses change, or comments are added',
    },
    {
      label: 'Connect anything',
      description:
        'Push feedback data to 6,000+ apps including spreadsheets, CRMs, and project tools',
    },
  ],
  iconBg: 'bg-[#FF4A00]',
  settingsPath: '/admin/settings/integrations/zapier',
  available: true,
}

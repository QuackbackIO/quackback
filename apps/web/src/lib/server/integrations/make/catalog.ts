import type { IntegrationCatalogEntry } from '../types'

export const makeCatalog: IntegrationCatalogEntry = {
  id: 'make',
  name: 'Make',
  description: 'Connect Quackback to Make (formerly Integromat) automation scenarios.',
  category: 'automation',
  capabilities: [
    {
      label: 'Trigger scenarios',
      description:
        'Trigger Make scenarios when feedback is submitted, statuses change, or comments are added',
    },
    {
      label: 'Visual automation',
      description: 'Build visual automation flows connecting feedback to 1,500+ apps in Make',
    },
  ],
  iconBg: 'bg-[#6D00CC]',
  settingsPath: '/admin/settings/integrations/make',
  available: true,
  configurable: false,
}

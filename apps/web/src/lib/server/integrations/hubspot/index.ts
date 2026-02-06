import type { IntegrationDefinition } from '../types'

export const hubspotIntegration: IntegrationDefinition = {
  id: 'hubspot',
  catalog: {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Enrich feedback with HubSpot contact data and deal value.',
    iconBg: 'bg-[#FF7A59]',
    settingsPath: '/admin/settings/integrations/hubspot',
    available: false,
  },
}

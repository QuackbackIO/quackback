import type { IntegrationDefinition } from '../types'

export const intercomIntegration: IntegrationDefinition = {
  id: 'intercom',
  catalog: {
    id: 'intercom',
    name: 'Intercom',
    description: 'Push feedback from Intercom conversations and sync customer data.',
    iconBg: 'bg-[#1F8DED]',
    settingsPath: '/admin/settings/integrations/intercom',
    available: false,
  },
}

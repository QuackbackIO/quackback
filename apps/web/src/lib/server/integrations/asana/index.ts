import type { IntegrationDefinition } from '../types'

export const asanaIntegration: IntegrationDefinition = {
  id: 'asana',
  catalog: {
    id: 'asana',
    name: 'Asana',
    description: 'Create Asana tasks from feedback and keep status in sync.',
    iconBg: 'bg-[#F06A6A]',
    settingsPath: '/admin/settings/integrations/asana',
    available: false,
  },
}

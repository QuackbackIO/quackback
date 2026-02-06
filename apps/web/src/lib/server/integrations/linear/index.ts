import type { IntegrationDefinition } from '../types'

export const linearIntegration: IntegrationDefinition = {
  id: 'linear',
  catalog: {
    id: 'linear',
    name: 'Linear',
    description: 'Sync feedback with Linear issues for seamless project management.',
    iconBg: 'bg-[#5E6AD2]',
    settingsPath: '/admin/settings/integrations/linear',
    available: false,
  },
}

import type { IntegrationDefinition } from '../types'

export const clickupIntegration: IntegrationDefinition = {
  id: 'clickup',
  catalog: {
    id: 'clickup',
    name: 'ClickUp',
    description: 'Turn feedback into ClickUp tasks and track progress.',
    iconBg: 'bg-[#7B68EE]',
    settingsPath: '/admin/settings/integrations/clickup',
    available: false,
  },
}

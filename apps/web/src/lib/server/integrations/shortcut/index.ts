import type { IntegrationDefinition } from '../types'

export const shortcutIntegration: IntegrationDefinition = {
  id: 'shortcut',
  catalog: {
    id: 'shortcut',
    name: 'Shortcut',
    description: 'Create Shortcut stories from feedback and sync status changes.',
    iconBg: 'bg-[#58B1E4]',
    settingsPath: '/admin/settings/integrations/shortcut',
    available: false,
  },
}

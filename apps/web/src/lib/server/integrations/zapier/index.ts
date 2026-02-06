import type { IntegrationDefinition } from '../types'

export const zapierIntegration: IntegrationDefinition = {
  id: 'zapier',
  catalog: {
    id: 'zapier',
    name: 'Zapier',
    description: 'Connect Quackback to 6,000+ apps with Zapier automations.',
    iconBg: 'bg-[#FF4A00]',
    settingsPath: '/admin/settings/integrations/zapier',
    available: false,
  },
}

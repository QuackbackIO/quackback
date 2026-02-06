import type { IntegrationDefinition } from '../types'

export const zendeskIntegration: IntegrationDefinition = {
  id: 'zendesk',
  catalog: {
    id: 'zendesk',
    name: 'Zendesk',
    description: 'Link Zendesk tickets to feedback posts and surface customer context.',
    iconBg: 'bg-[#03363D]',
    settingsPath: '/admin/settings/integrations/zendesk',
    available: false,
  },
}

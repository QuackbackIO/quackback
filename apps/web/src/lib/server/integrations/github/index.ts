import type { IntegrationDefinition } from '../types'

export const githubIntegration: IntegrationDefinition = {
  id: 'github',
  catalog: {
    id: 'github',
    name: 'GitHub',
    description: 'Create GitHub issues from feedback and sync status updates.',
    iconBg: 'bg-[#24292F]',
    settingsPath: '/admin/settings/integrations/github',
    available: false,
  },
}

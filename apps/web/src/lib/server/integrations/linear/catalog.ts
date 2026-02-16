import type { IntegrationCatalogEntry } from '../types'

export const linearCatalog: IntegrationCatalogEntry = {
  id: 'linear',
  name: 'Linear',
  description: 'Create Linear issues from feedback and keep statuses in sync.',
  category: 'issue_tracking',
  capabilities: [
    {
      label: 'Create issues',
      description: 'Automatically create a Linear issue when new feedback is submitted',
    },
    {
      label: 'Link posts to issues',
      description: 'Link feedback posts to existing Linear issues for traceability',
    },
    {
      label: 'Sync statuses',
      description: 'Keep feedback status in sync with Linear issue workflow states',
    },
  ],
  iconBg: 'bg-[#5E6AD2]',
  settingsPath: '/admin/settings/integrations/linear',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/linear',
}

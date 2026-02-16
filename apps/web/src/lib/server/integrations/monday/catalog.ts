import type { IntegrationCatalogEntry } from '../types'

export const mondayCatalog: IntegrationCatalogEntry = {
  id: 'monday',
  name: 'Monday.com',
  description: 'Create items in Monday.com from feedback and sync statuses.',
  category: 'issue_tracking',
  capabilities: [
    {
      label: 'Create items',
      description: 'Automatically create Monday.com items when new feedback is submitted',
    },
    {
      label: 'Two-way status sync',
      description:
        'Status changes in Monday.com update the feedback status in Quackback and vice versa',
    },
    {
      label: 'Board integration',
      description: 'Select which board and group to create items in, with rich descriptions',
    },
  ],
  iconBg: 'bg-[#FF3D57]',
  settingsPath: '/admin/settings/integrations/monday',
  available: true,
  configurable: true,
  docsUrl: 'https://www.quackback.io/docs/integrations/monday',
}

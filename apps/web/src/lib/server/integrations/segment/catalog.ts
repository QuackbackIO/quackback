import type { IntegrationCatalogEntry } from '../types'

export const segmentCatalog: IntegrationCatalogEntry = {
  id: 'segment',
  name: 'Segment',
  description: 'Sync user traits from Segment into Quackback and push segment membership back.',
  category: 'user_data',
  capabilities: [
    {
      label: 'Inbound trait sync',
      description:
        'Receive Segment identify events and write user traits to Quackback user attributes automatically',
    },
    {
      label: 'Segment membership sync',
      description:
        'After dynamic segment evaluation, push membership changes back to Segment as user traits',
    },
  ],
  iconBg: 'bg-[#52BD94]',
  settingsPath: '/admin/settings/integrations/segment',
  available: true,
  configurable: false,
  docsUrl: 'https://segment.com/docs/connections/sources/catalog/libraries/server/http-api/',
}
